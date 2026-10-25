# @domusops/schema

## 0.1.1

### Patch Changes

- b520d21: Every package now ships its TypeScript sources next to `dist`, so the source maps and declaration maps in a package resolve from the package alone. `@domusops/schema` gains a README that says what the package is, how to install it, which formats it exports, and what stability it promises.

## 0.1.0

### Minor Changes

- 7ac64f8: Add the `domusops.logbook/0.1` format: the row, envelope, standard, and summary document types, the projection (`projectLogbook`), the context ID encoding, a JSON Schema (`logbookJsonSchema`), and a reference decoder (`expandLogbook`).
- 2afee5a: Add the `domusops.snapshot/0.1` format: types, the omission list, field defaults, the redaction marker, the key-space helpers, a JSON Schema, and a reference decoder (`expand`). Replaces the placeholder `HaSnapshot` type, which is a breaking change in 0.x.
- 6ae8715: Add the `domusops.trace/0.1` format: the extended and short trace record types, the envelope, standard, and summary document types, the value decoder (`decodeValue`) and timestamp helpers, a JSON Schema (`traceJsonSchema`), and a reference decoder (`expandTrace`).

  `expandTrace` keeps an explicit `last_step: null` and derives the last step from the steps only when the key is absent, so the round trip of a run that stopped before any step is lossless.
