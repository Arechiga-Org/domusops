---
"@domusops/schema": minor
---

Adds the `domusops.scenario/0.1` format, the declarative scenarios a configuration repository keeps next to its automations, and the `domusops.scenario-report/0.1` format of a run. Exports `SCENARIO_FORMAT`, `SCENARIO_REPORT_FORMAT`, the defaults (`DEFAULT_SCENARIO_DATE`, `DEFAULT_SCENARIO_TIME`, `DEFAULT_SCENARIO_TIMEOUT_SECONDS`, `DEFAULT_SETTLE_SECONDS`), `STAND_IN_KINDS`, the types of the normalised scenario and of the report, `checkScenarioDocument` (every issue of a parsed document, with a JSON Pointer path), `normalizeScenarioDocument`, `resolveSuite`, `compareValue`, and the JSON Schemas `scenarioJsonSchema` and `scenarioReportJsonSchema`, also shipped under `schema/` for editors. The first grammar covers a starting point with a date, a time and entity states, one step or a list of state, action and event steps, and expectations on entity states and attributes, automations triggered and actions called. No existing format changes.
