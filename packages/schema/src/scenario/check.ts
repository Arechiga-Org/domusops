import { SCENARIO_FORMAT, type ScenarioIssue } from "./format.js";
import type { ScenarioIssueCode } from "./format.js";
import {
  isAction,
  isCalendarDate,
  isEntityId,
  isEventType,
  isScenarioName,
  parseTimeOfDay,
} from "./values.js";

type Obj = Record<string, unknown>;

/** The keys that make an object a comparison rather than a value to compare with (R10). */
export const COMPARISON_KEYS = [
  "not",
  "in",
  "at_least",
  "at_most",
  "between",
] as const;

const SCENARIO_KEYS = [
  "scenario",
  "description",
  "given",
  "when",
  "then",
  "timeout",
  "settle",
];
const TARGET_KEYS = ["entity_id", "device_id", "area_id"];

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

const isDotted = (key: string): boolean => key.includes(".");

const escape = (key: string): string =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");

const at = (base: string, key: string | number): string =>
  `${base}/${escape(String(key))}`;

class Issues {
  readonly list: ScenarioIssue[] = [];

  add(path: string, code: ScenarioIssueCode, message: string): void {
    this.list.push({ path, code, message });
  }

  /** Reports every key of `obj` that is not in `allowed` (entity IDs are the caller's business). */
  unknownKeys(obj: Obj, base: string, allowed: readonly string[]): void {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        this.add(at(base, key), "unknown_key", `unknown key \`${key}\``);
      }
    }
  }
}

function checkComparison(value: unknown, path: string, out: Issues): void {
  if (!isObject(value)) return; // a scalar, null or list is a value to compare with
  const keys = Object.keys(value);
  const operators = keys.filter((k) =>
    (COMPARISON_KEYS as readonly string[]).includes(k),
  );
  if (operators.length === 0) return; // an object to compare with as JSON
  const [operator] = operators;
  if (keys.length !== 1 || operator === undefined) {
    out.add(
      path,
      "bad_comparison",
      `a comparison has exactly one of ${COMPARISON_KEYS.join(", ")}`,
    );
    return;
  }
  const operand = value[operator];
  const where = at(path, operator);
  switch (operator) {
    case "in":
      if (!Array.isArray(operand) || operand.length === 0) {
        out.add(where, "bad_comparison", "`in` takes a non-empty list");
      }
      break;
    case "at_least":
    case "at_most":
      if (typeof operand !== "number" || !Number.isFinite(operand)) {
        out.add(where, "bad_comparison", `\`${operator}\` takes a number`);
      }
      break;
    case "between": {
      const [low, high] = Array.isArray(operand) ? operand : [];
      if (
        !Array.isArray(operand) ||
        operand.length !== 2 ||
        typeof low !== "number" ||
        typeof high !== "number" ||
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        low > high
      ) {
        out.add(
          where,
          "bad_comparison",
          "`between` takes two numbers, low then high",
        );
      }
      break;
    }
    default:
      break; // `not` takes any value
  }
}

/** An entity's state and attributes, as `given` and a state step write them (contract §3). */
function checkEntityValue(value: unknown, path: string, out: Issues): void {
  if (isScalar(value)) return;
  if (!isObject(value)) {
    out.add(path, "wrong_type", "an entity value is a state or a mapping");
    return;
  }
  if (!("state" in value)) {
    out.add(path, "missing_key", "an entity mapping needs a `state`");
  } else if (!isScalar(value["state"])) {
    out.add(
      at(path, "state"),
      "wrong_type",
      "`state` is a text, number or boolean",
    );
  }
  if ("attributes" in value && !isObject(value["attributes"])) {
    out.add(at(path, "attributes"), "wrong_type", "`attributes` is a mapping");
  }
}

function checkIdList(
  value: unknown,
  path: string,
  out: Issues,
  entity: boolean,
): void {
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) {
    out.add(path, "empty_list", "the list is empty");
    return;
  }
  items.forEach((item, i) => {
    const where = Array.isArray(value) ? at(path, i) : path;
    if (typeof item !== "string" || item === "") {
      out.add(where, "wrong_type", "an ID is a non-empty text");
    } else if (entity && !isEntityId(item)) {
      out.add(where, "bad_entity_id", `\`${item}\` is not an entity ID`);
    }
  });
}

function checkTarget(value: unknown, path: string, out: Issues): void {
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.add(
        path,
        "missing_key",
        "a target needs entity_id, device_id or area_id",
      );
      return;
    }
    out.unknownKeys(value, path, TARGET_KEYS);
    for (const key of TARGET_KEYS) {
      if (key in value) {
        checkIdList(value[key], at(path, key), out, key === "entity_id");
      }
    }
    return;
  }
  checkIdList(value, path, out, true);
}

function checkData(value: unknown, path: string, out: Issues): void {
  if (!isObject(value)) out.add(path, "wrong_type", "`data` is a mapping");
}

function checkStep(step: unknown, path: string, out: Issues): void {
  if (!isObject(step)) {
    out.add(path, "wrong_type", "a step is a mapping");
    return;
  }
  const keys = Object.keys(step);
  if (keys.length === 0) {
    out.add(path, "missing_key", "a step needs an entity, `action` or `event`");
    return;
  }
  const entityKeys = keys.filter(isDotted);
  const kinds = [
    ...(entityKeys.length > 0 ? ["an entity"] : []),
    ...("action" in step ? ["`action`"] : []),
    ...("event" in step ? ["`event`"] : []),
  ];
  if (kinds.length > 1) {
    out.add(path, "exclusive_keys", `a step is one of ${kinds.join(", ")}`);
    return;
  }
  if ("action" in step) {
    out.unknownKeys(step, path, ["action", "target", "data"]);
    if (!isAction(step["action"])) {
      out.add(
        at(path, "action"),
        typeof step["action"] === "string" ? "bad_action" : "wrong_type",
        "an action is `<domain>.<service>`",
      );
    }
    if ("target" in step) checkTarget(step["target"], at(path, "target"), out);
    if ("data" in step) checkData(step["data"], at(path, "data"), out);
  } else if ("event" in step) {
    out.unknownKeys(step, path, ["event", "data"]);
    if (!isEventType(step["event"])) {
      out.add(
        at(path, "event"),
        typeof step["event"] === "string" ? "bad_name" : "wrong_type",
        "an event type is lower-case words joined by underscores",
      );
    }
    if ("data" in step) checkData(step["data"], at(path, "data"), out);
  } else {
    for (const key of keys) {
      if (!isDotted(key)) {
        out.add(at(path, key), "unknown_key", `unknown key \`${key}\``);
      } else if (!isEntityId(key)) {
        out.add(
          at(path, key),
          "bad_entity_id",
          `\`${key}\` is not an entity ID`,
        );
      } else {
        checkEntityValue(step[key], at(path, key), out);
      }
    }
  }
}

function checkWhen(value: unknown, path: string, out: Issues): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.add(path, "empty_list", "`when` has no steps");
    }
    value.forEach((step, i) => checkStep(step, at(path, i), out));
  } else {
    checkStep(value, path, out);
  }
}

function checkTimes(value: unknown, path: string, out: Issues): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    out.add(path, "wrong_type", "`times` is a whole number, 0 or more");
  }
}

function checkSettle(value: unknown, path: string, out: Issues): void {
  if (typeof value !== "number" || !(value > 0 && value <= 3600)) {
    out.add(
      path,
      "bad_duration",
      "`settle` is a number of seconds greater than 0 and at most 3600",
    );
  }
}

/** An entity expectation's value: a state to equal, or a mapping of comparisons (contract §5.1). */
function checkExpectedEntity(value: unknown, path: string, out: Issues): void {
  if (value === null || isScalar(value)) return;
  if (!isObject(value)) {
    out.add(path, "wrong_type", "an expected value is a state or a mapping");
    return;
  }
  if (Object.keys(value).length === 0) {
    out.add(
      path,
      "missing_key",
      "an expectation checks the state or an attribute",
    );
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "attributes") {
      if (!isObject(item)) {
        out.add(at(path, key), "wrong_type", "`attributes` is a mapping");
        continue;
      }
      for (const [name, comparison] of Object.entries(item)) {
        checkComparison(comparison, at(at(path, key), name), out);
      }
    } else if ((COMPARISON_KEYS as readonly string[]).includes(key)) {
      out.add(
        at(path, key),
        "bad_comparison",
        `\`${key}\` is a comparison; write it under \`state\`, or under \`attributes\` for an attribute of that name`,
      );
    } else {
      checkComparison(item, at(path, key), out);
    }
  }
}

function checkExpectation(item: unknown, path: string, out: Issues): void {
  if (!isObject(item)) {
    out.add(path, "wrong_type", "an expectation is a mapping");
    return;
  }
  const keys = Object.keys(item);
  const entityKeys = keys.filter(isDotted);
  const named = ["triggered", "called", "not_called"].filter((k) => k in item);
  const kinds = [
    ...entityKeys.map((k) => `\`${k}\``),
    ...named.map((k) => `\`${k}\``),
  ];
  if (kinds.length > 1) {
    out.add(
      path,
      "exclusive_keys",
      `an expectation is one of ${kinds.join(", ")}`,
    );
    return;
  }
  const [kind] = named;
  const [entityKey] = entityKeys;
  if (kind === undefined && entityKey === undefined) {
    if (keys.length === 0) {
      out.add(
        path,
        "missing_key",
        "an expectation names an entity, `triggered` or `called`",
      );
    }
    for (const key of keys) {
      out.add(at(path, key), "unknown_key", `unknown key \`${key}\``);
    }
    return;
  }
  const allowed =
    kind === "triggered"
      ? ["triggered", "times", "settle"]
      : kind === "called"
        ? ["called", "target", "data", "times", "settle"]
        : kind === "not_called"
          ? ["not_called", "target", "data", "settle"]
          : [entityKey ?? "", "settle"];
  for (const key of keys) {
    if (!allowed.includes(key)) {
      out.add(
        at(path, key),
        kind === "not_called" && key === "times"
          ? "exclusive_keys"
          : "unknown_key",
        kind === "not_called" && key === "times"
          ? "`not_called` already means no calls; use `called` with `times`"
          : `unknown key \`${key}\``,
      );
    }
  }
  if ("settle" in item) checkSettle(item["settle"], at(path, "settle"), out);
  if (entityKey !== undefined) {
    if (!isEntityId(entityKey)) {
      out.add(
        at(path, entityKey),
        "bad_entity_id",
        `\`${entityKey}\` is not an entity ID`,
      );
    } else {
      checkExpectedEntity(item[entityKey], at(path, entityKey), out);
    }
    return;
  }
  if (kind === "triggered") {
    const automation = item["triggered"];
    if (!isEntityId(automation) || !automation.startsWith("automation.")) {
      out.add(
        at(path, "triggered"),
        "bad_entity_id",
        "`triggered` names an automation, `automation.<id>`",
      );
    }
  } else if (kind !== undefined) {
    if (!isAction(item[kind])) {
      out.add(
        at(path, kind),
        typeof item[kind] === "string" ? "bad_action" : "wrong_type",
        "an action is `<domain>.<service>`",
      );
    }
    if ("target" in item) checkTarget(item["target"], at(path, "target"), out);
    if ("data" in item) {
      const data = item["data"];
      if (!isObject(data)) {
        out.add(at(path, "data"), "wrong_type", "`data` is a mapping");
      } else {
        for (const [field, comparison] of Object.entries(data)) {
          checkComparison(comparison, at(at(path, "data"), field), out);
        }
      }
    }
  }
  if ("times" in item) checkTimes(item["times"], at(path, "times"), out);
}

function checkThen(value: unknown, path: string, out: Issues): void {
  if (!Array.isArray(value)) {
    out.add(path, "wrong_type", "`then` is a list of expectations");
    return;
  }
  if (value.length === 0) {
    out.add(path, "empty_list", "`then` has no expectations");
  }
  value.forEach((item, i) => checkExpectation(item, at(path, i), out));
}

function checkGiven(value: unknown, path: string, out: Issues): void {
  if (!isObject(value)) {
    out.add(path, "wrong_type", "`given` is a mapping");
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const where = at(path, key);
    if (key === "date") {
      if (typeof item !== "string") {
        out.add(where, "wrong_type", "`date` is a text, YYYY-MM-DD");
      } else if (!isCalendarDate(item)) {
        out.add(where, "bad_date", "`date` is a real day, YYYY-MM-DD");
      }
    } else if (key === "time") {
      if (typeof item !== "string") {
        out.add(where, "wrong_type", "`time` is a text, HH:MM or HH:MM:SS");
      } else if (parseTimeOfDay(item) === null) {
        out.add(where, "bad_time", "`time` is HH:MM or HH:MM:SS, 24-hour");
      }
    } else if (!isDotted(key)) {
      out.add(where, "unknown_key", `unknown key \`${key}\``);
    } else if (!isEntityId(key)) {
      out.add(where, "bad_entity_id", `\`${key}\` is not an entity ID`);
    } else {
      checkEntityValue(item, where, out);
    }
  }
}

function checkScenario(
  value: Obj,
  base: string,
  root: boolean,
  out: Issues,
): void {
  out.unknownKeys(
    value,
    base,
    root ? ["format", ...SCENARIO_KEYS] : SCENARIO_KEYS,
  );
  for (const key of ["scenario", "given", "when", "then"]) {
    if (!(key in value)) out.add(base, "missing_key", `missing \`${key}\``);
  }
  const name = value["scenario"];
  if ("scenario" in value) {
    if (typeof name !== "string") {
      out.add(at(base, "scenario"), "wrong_type", "`scenario` is a text");
    } else if (!isScenarioName(name)) {
      out.add(
        at(base, "scenario"),
        "bad_name",
        "a name is lower-case words joined by underscores, at most 64 characters",
      );
    }
  }
  if ("description" in value && typeof value["description"] !== "string") {
    out.add(at(base, "description"), "wrong_type", "`description` is a text");
  }
  if ("timeout" in value) {
    const timeout = value["timeout"];
    if (typeof timeout !== "number" || !(timeout >= 30 && timeout <= 3600)) {
      out.add(
        at(base, "timeout"),
        "bad_duration",
        "`timeout` is a number of seconds, 30 to 3600",
      );
    }
  }
  if ("settle" in value) checkSettle(value["settle"], at(base, "settle"), out);
  if ("given" in value) checkGiven(value["given"], at(base, "given"), out);
  if ("when" in value) checkWhen(value["when"], at(base, "when"), out);
  if ("then" in value) checkThen(value["then"], at(base, "then"), out);
}

/**
 * Every issue of one parsed scenario document, with a JSON Pointer path; empty when it is valid.
 * Pure: no files, no instance. The checks that span files (unique names, `use` references) are
 * `resolveSuite`'s.
 */
export function checkScenarioDocument(value: unknown): ScenarioIssue[] {
  const out = new Issues();
  if (!isObject(value)) {
    out.add("", "wrong_type", "a scenario document is a mapping");
    return out.list;
  }
  if (!("format" in value)) {
    out.add(
      "",
      "format_missing",
      `the document must declare \`format: ${SCENARIO_FORMAT}\``,
    );
  } else if (typeof value["format"] !== "string") {
    out.add("/format", "wrong_type", "`format` is a text");
  } else if (value["format"] !== SCENARIO_FORMAT) {
    // A newer grammar may differ in ways that would only produce noise: refuse it as a whole.
    out.add(
      "/format",
      "format_unsupported",
      `\`${value["format"]}\` is not supported; this reader understands ${SCENARIO_FORMAT}`,
    );
    return out.list;
  }
  const several = "scenarios" in value;
  const sections = ["scenario", "given", "when", "then"];
  if (several && "scenario" in value) {
    out.add(
      "",
      "exclusive_keys",
      "a document has `scenario` or `scenarios`, not both",
    );
  } else if (several) {
    out.unknownKeys(value, "", ["format", "scenarios"]);
    const list = value["scenarios"];
    if (!Array.isArray(list)) {
      out.add("/scenarios", "wrong_type", "`scenarios` is a list");
    } else if (list.length === 0) {
      out.add("/scenarios", "empty_list", "`scenarios` has no scenarios");
    } else {
      list.forEach((item, i) => {
        const where = at("/scenarios", i);
        if (isObject(item)) checkScenario(item, where, false, out);
        else out.add(where, "wrong_type", "a scenario is a mapping");
      });
    }
  } else if (sections.some((key) => key in value)) {
    checkScenario(value, "", true, out);
  } else {
    out.add("", "missing_key", "a document needs `scenario` or `scenarios`");
    out.unknownKeys(value, "", ["format"]);
  }
  return out.list;
}
