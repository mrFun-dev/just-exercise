# Odometer Reading Service

A simple service that reads the mileage off a photo of a car odometer. One endpoint:

```
POST /odometer/reading
```

It runs on port `3000` by default (`http://localhost:3000/odometer/reading`). There is also `GET /health`, and a minimal HTML client at `http://localhost:3000` for submitting an image by hand.

## Running it

```bash
cd just-exercise
npm install
npm run dev
```

That starts on the mock OCR engine, so it runs with no credentials and no setup. To use the real one:

```bash
cp .env.example .env      # then add your key:
#   ANTHROPIC_API_KEY=sk-ant-...
#   OCR_PROVIDER=claude
npm run dev
```

```bash
curl -X POST http://localhost:3000/odometer/reading \
  -F "image=@images/3ae9d173-8895-409e-844c-77b5841138d7.jpeg"
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run locally with reload; loads `.env` if present |
| `npm test` | Run the test suite (25 tests, no network) |
| `npm run build` / `npm start` | Compile to `dist/` and run |

## What it does

Takes a JPEG or PNG of an odometer and returns the reading:

```json
{ "reading": 48253, "unit": "miles", "confidence": "high" }
```

Images arrive either as `multipart/form-data` (field name `image`) or as JSON `{ "image": "<base64>" }` — raw base64 or a `data:` URL. Both paths produce identical answers.

On the live path the image goes to a **Claude vision model** (`claude-sonnet-5` by default). For tests, and for evaluation without credentials, a **mock** engine returns a fixed reading and never looks at the image. Which one runs is set by `OCR_PROVIDER`; an unrecognised value stops the process at boot rather than quietly falling back to the mock.

### How a request flows

```
request → gate → OCR provider → reading policy → log → response
       400/413/415     422/500    business rules
```

The three stages are deliberately separate. The **gate** decides whether this is even an image we could read. The **provider** reports only what it saw — a raw observation, possibly with a decimal, possibly labelled in kilometres. The **policy** turns that observation into an answer. Swapping the OCR engine therefore cannot change the API contract, and every business rule sits in one small, pure, fully-tested file (`src/odometer/reading-policy.ts`).

## Decisions

**Everything is reported in miles.** The market is the US, so `unit` is always `"miles"` and no kilometre conversion is ever performed. If the display is visibly labelled in kilometres, the number is still returned unchanged, but `confidence` drops to `low`. An *unlabelled* display also drops to `low`: we assert miles, so full confidence requires the display to have actually said so. This is deliberately conservative and costs signal — most odometers carry no unit marking — but the alternative is quietly asserting a unit nobody verified, on data that feeds billing.

**Decimals round down.** Readings are floored to whole miles, never rounded up. Tenths usually belong to the trip meter rather than the lifetime total, and on a pay-per-mile policy a rounded-up mile is a mile the customer is billed for but did not drive. When in doubt, err toward the customer.

**Non-image files are rejected before any OCR runs.** Only JPEG and PNG are accepted, and the check reads the file's magic bytes rather than trusting the client's `Content-Type` header.

**A doubtful reading is returned, not withheld.** The service always returns whatever was extracted and expresses uncertainty through `confidence`; deciding what to do with a doubtful number is the caller's job. `confidence` starts at the model's own certainty and is only ever lowered. It drops to `low` when the unit is not explicitly miles, when the value is all-identical digits (`111111` — the signature of glare or a dead segment), when it is `0` (what `000000` becomes once it is a number), when it exceeds 999,998 (six digits is the mechanical ceiling), or when it is negative. `422 UNREADABLE_IMAGE` is reserved for the genuinely different case: no number could be extracted at all.

**Accuracy is prioritised over speed.** Photo submission is asynchronous, so a slower request costs nothing a customer notices, while a wrong reading is an overcharge or lost revenue. Two consequences: the default model is `claude-sonnet-5` rather than something cheaper and weaker, and every image is sent to the model **twice**.

### Two samples, and what they buy

The two calls run in parallel, so latency is roughly unchanged; the cost is 2× tokens. The samples are reconciled before policy runs:

| Samples | Result |
| --- | --- |
| Both readable, same whole-mile reading | Keep it; certainty is the **lower** of the two, then bumped one step (`low`→`medium`→`high`, capped at `high`) |
| Both readable, different whole-mile readings | Keep the **lowest** reading; force `confidence` to `low` |
| One readable, one not | Keep the reading that was found; force `confidence` to `low` |
| Neither readable | `422 UNREADABLE_IMAGE` |
| `CLAUDE_SAMPLES=1` | Pass straight through — no bump, no drop |

Readings are compared *after* flooring, so `48253.7` and `48253.2` count as agreement — they bill identically. On disagreement the rule is always the **lowest** reading, never whichever call resolved first: sample order is a `Promise.all` artefact, not a signal, and when we cannot tell which read is right, the defensible direction is the one that cannot overcharge. The number is still returned, flagged `low`, so a caller can route it to review.

The risk going in was that near-deterministic structured output would make the samples always agree, leaving the second call as pure cost. That has not held: on a blurry dashboard photo the two samples returned **15450** and **15945**, both self-reporting `medium`. A single call would have returned one of those as a confident answer, with nothing downstream able to tell it apart from a good read.

## The checks an image goes through

Everything below runs before the OCR engine is called, in this order. Each rejection has a specific status and code, and all share the envelope `{ "error": "<CODE>", "message": "<message>" }`.

| Check | Failure |
| --- | --- |
| `Content-Length` within 10MB | `413 PAYLOAD_TOO_LARGE` — rejected before a byte of body is read |
| Body is parseable JSON | `400 INVALID_JSON` |
| Multipart body is well-formed, one file only | `400 INVALID_UPLOAD`, or `413 PAYLOAD_TOO_LARGE` if the stream lied about its size |

## Logging

One JSON line per request, written in `src/odometer/reading.ts` after the policy runs and before the response is sent — on both the success and the 422 path. It exists so maintainers can see *why* the service answered as it did:

```json
{"reading":15450,"unit":"miles","confidence":"low","agreed":false,
 "samples":[
   {"readable":true,"reading":15450,"unitShown":"miles","certainty":"medium",
    "reason":"Main odometer reads '15450'; smaller '104' above is the trip meter. Image is blurry but digits are distinguishable."},
   {"readable":true,"reading":15945,"unitShown":"miles","certainty":"medium",
    "reason":"Main odometer reads '15945'; image is blurry but digits are distinguishable."}]}
```

The model is asked to explain its own certainty, and each explanation stays attached to the sample it justifies — which is the whole value when the samples disagree. None of it is returned to the client.

## Tests

25 tests, six files, no network calls. Run with `npm test`.

| File | Covers |
| --- | --- |
| `unit/reading-policy` | Flooring and never rounding up; miles always reported and never converted; only an explicitly miles-labelled display keeps full confidence; certainty preserved and never raised; implausible values flagged but still returned |
| `unit/reconcile` | Single-sample pass-through; both unreadable; mixed readable/unreadable; tenths treated as agreement with the bump capped at `high`; the lowest reading taken on disagreement |
| `unit/claude` | Structured output mapped to an observation with the decimal intact; unreadable mapped to a failure; `max_tokens` and `refusal` raise; two samples reconciled |
| `unit/gate` | Base64 accepted raw, as a `data:` URL and unpadded, rejected otherwise; JPEG and PNG identified by magic bytes and nothing else |
| `unit/providers` | The mock returns an observation, not a finished response; the factory resolves known names and rejects unknown ones |
| `api/reading` | Both transports answer identically; every rejection code above; policy applied end to end with diagnostics kept off the body; 422 and 500 kept distinct |

Failure paths are exercised by injecting test doubles through `createApp({ ocrProvider })` rather than shipping stub engines in the service. The suite is deliberately capped at 25 — one test per distinct decision or failure mode, with no parametrized repetition of the same branch.

## Configuration

All settings are read in exactly one place, `src/config.ts`, once at startup. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `OCR_PROVIDER` | `mock` | `mock` or `claude` |
| `ANTHROPIC_API_KEY` | — | Required when `OCR_PROVIDER=claude` |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | `claude-opus-5` for the accuracy ceiling |
| `CLAUDE_SAMPLES` | `2` | Vision calls per image; each one is billed |
| `ANTHROPIC_TIMEOUT_MS` | `600000` | Passed to the SDK client |
| `ANTHROPIC_MAX_RETRIES` | `2` | Passed to the SDK client; no extra retry loop |
| `MAX_PAYLOAD_BYTES` | `10485760` | Request body ceiling |

A malformed numeric value throws a named error at boot (`PORT must be a whole number >= 1, got "abc"`) instead of falling back. Environment variables are for values that differ between deployments; business rules such as the plausibility ceiling stay in code, where they are reviewed and tested.

## What I would do next

Ordered by what I would actually pick up first. This is a proof of concept, so the list is as much a statement of what was consciously left out as of what is missing.

**Reconcile `MAX_PAYLOAD_BYTES` with the vision API's image limit.** 

**Defend against adversarial images.** 

**Make a reading auditable.** The log line has no correlation ID

**Lower the timeout.** `ANTHROPIC_TIMEOUT_MS` 
**Cut the sampling cost.** 
### Smaller, known, deliberate

**The image is base64-encoded once per sample.** 

**Scaling is horizontal.** The workload is I/O-bound and the service is stateless, so concurrent requests already overlap on one event loop. Going beyond one core means more processes — `cluster`, PM2, or container replicas — not more `async`.

**Two things are verified only by hand.** No test makes a live API call
