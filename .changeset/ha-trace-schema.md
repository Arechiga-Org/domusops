---
"@domusops/schema": minor
---

Add the `domusops.trace/0.1` format: the extended and short trace record types, the envelope, standard, and summary document types, the value decoder (`decodeValue`) and timestamp helpers, a JSON Schema (`traceJsonSchema`), and a reference decoder (`expandTrace`).

`expandTrace` keeps an explicit `last_step: null` and derives the last step from the steps only when the key is absent, so the round trip of a run that stopped before any step is lossless.
