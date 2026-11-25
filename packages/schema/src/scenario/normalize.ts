import { COMPARISON_KEYS } from "./check.js";
import {
  DEFAULT_SETTLE_SECONDS,
  type Comparison,
  type EntityValue,
  type Expectation,
  type Json,
  type NamedStartingPoint,
  type ScenarioDraft,
  type ScenarioFile,
  type Scalar,
  type Step,
  type StartingPointDraft,
  type Target,
} from "./format.js";
import { parseTimeOfDay } from "./values.js";

type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDotted = (key: string): boolean => key.includes(".");

const at = (base: string, key: string | number): string =>
  `${base}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

function entityValue(value: unknown): EntityValue {
  if (!isObject(value)) return { state: value as Scalar, attributes: {} };
  const attributes: Record<string, Json> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "state") continue;
    if (key === "attributes" && isObject(item)) {
      Object.assign(attributes, item);
    } else {
      attributes[key] = item as Json;
    }
  }
  return { state: value["state"] as Scalar, attributes };
}

function comparison(value: unknown): Comparison {
  if (isObject(value)) {
    const keys = Object.keys(value);
    const [operator] = keys;
    if (
      keys.length === 1 &&
      operator !== undefined &&
      (COMPARISON_KEYS as readonly string[]).includes(operator)
    ) {
      const operand = value[operator];
      switch (operator) {
        case "not":
          return { not: operand as Json };
        case "in":
          return { in: operand as Json[] };
        case "at_least":
          return { at_least: operand as number };
        case "at_most":
          return { at_most: operand as number };
        default:
          return { between: operand as [number, number] };
      }
    }
  }
  return { eq: value as Json };
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

function target(value: unknown): Target {
  if (!isObject(value)) return { entity_id: ids(value) };
  const out: Target = {};
  if ("entity_id" in value) out.entity_id = ids(value["entity_id"]);
  if ("device_id" in value) out.device_id = ids(value["device_id"]);
  if ("area_id" in value) out.area_id = ids(value["area_id"]);
  return out;
}

function data(value: unknown): Record<string, Json> {
  return isObject(value) ? (value as Record<string, Json>) : {};
}

function step(value: Obj, path: string): Step {
  if ("action" in value) {
    return {
      kind: "action",
      action: value["action"] as string,
      ...("target" in value ? { target: target(value["target"]) } : {}),
      data: data(value["data"]),
      path,
    };
  }
  if ("event" in value) {
    return {
      kind: "event",
      eventType: value["event"] as string,
      data: data(value["data"]),
      path,
    };
  }
  return {
    kind: "states",
    entities: Object.entries(value).map(([id, item]) => [
      id,
      entityValue(item),
    ]),
    path,
  };
}

function expectation(
  item: Obj,
  index: number,
  base: string,
  scenarioSettle: number,
): Expectation {
  const common = {
    within: 0,
    settle:
      typeof item["settle"] === "number" ? item["settle"] : scenarioSettle,
    at: `then[${index}]`,
    path: at(base, index),
  };
  const times =
    typeof item["times"] === "number" ? { times: item["times"] } : {};
  if ("triggered" in item) {
    return {
      kind: "triggered",
      automation: item["triggered"] as string,
      ...times,
      ...common,
    };
  }
  const calledKey = "called" in item ? "called" : "not_called";
  if (calledKey in item) {
    return {
      kind: "called",
      action: item[calledKey] as string,
      ...("target" in item ? { target: target(item["target"]) } : {}),
      data: Object.entries(data(item["data"])).map(
        ([field, value]): [string, Comparison] => [field, comparison(value)],
      ),
      ...(calledKey === "not_called" ? { times: 0 } : times),
      ...common,
    };
  }
  const entityId = Object.keys(item).find(isDotted) ?? "";
  const expected = item[entityId];
  if (!isObject(expected)) {
    return {
      kind: "entity",
      entityId,
      state: { eq: expected as Json },
      attributes: [],
      ...common,
    };
  }
  const attributes: [string, Comparison][] = [];
  let state: Comparison | undefined;
  for (const [key, value] of Object.entries(expected)) {
    if (key === "state") {
      state = comparison(value);
    } else if (key === "attributes" && isObject(value)) {
      for (const [name, each] of Object.entries(value)) {
        attributes.push([name, comparison(each)]);
      }
    } else {
      attributes.push([key, comparison(value)]);
    }
  }
  return {
    kind: "entity",
    entityId,
    ...(state === undefined ? {} : { state }),
    attributes,
    ...common,
  };
}

function startingPoint(given: Obj): StartingPointDraft {
  const time = parseTimeOfDay(given["time"]);
  return {
    use: [],
    ...(typeof given["date"] === "string" ? { date: given["date"] } : {}),
    ...(time === null ? {} : { time }),
    entities: Object.entries(given)
      .filter(([key]) => isDotted(key))
      .map(([id, item]): [string, EntityValue] => [id, entityValue(item)]),
    standIns: [],
    absentActions: [],
  };
}

function scenario(value: Obj, base: string): ScenarioDraft {
  const settle =
    typeof value["settle"] === "number"
      ? value["settle"]
      : DEFAULT_SETTLE_SECONDS;
  const when = value["when"];
  const steps: Step[] = Array.isArray(when)
    ? when.map((each, j) => step(each as Obj, at(`${base}/when`, j)))
    : [step(when as Obj, `${base}/when`)];
  const then = (value["then"] as Obj[]).map((item, i) =>
    expectation(item, i, `${base}/then`, settle),
  );
  steps.push({ kind: "expect", expectations: then, path: `${base}/then` });
  return {
    name: value["scenario"] as string,
    ...(typeof value["description"] === "string"
      ? { description: value["description"] }
      : {}),
    path: base,
    given: startingPoint(value["given"] as Obj),
    steps,
    ...(typeof value["timeout"] === "number"
      ? { timeout: value["timeout"] }
      : {}),
    settle,
  };
}

/**
 * The scenarios of one document that `checkScenarioDocument` accepted, in the shape the runner
 * executes (data-model §1). The defaults that depend on the rest of the suite (the date and time
 * of the starting point, the time limit) are filled by `resolveSuite`.
 */
export function normalizeScenarioDocument(value: unknown): ScenarioFile {
  const doc = value as Obj;
  const scenarios: ScenarioDraft[] = Array.isArray(doc["scenarios"])
    ? (doc["scenarios"] as Obj[]).map((each, i) =>
        scenario(each, at("/scenarios", i)),
      )
    : [scenario(doc, "")];
  const startingPoints: NamedStartingPoint[] = [];
  return { scenarios, startingPoints };
}
