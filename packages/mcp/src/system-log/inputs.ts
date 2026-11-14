import {
  SYSTEM_LOG_LEVELS,
  type SystemLogDetailLevel,
  type SystemLogLevel,
} from "@domusops/schema";
import { errors } from "../errors.js";
import { parseSelectors } from "../logbook/selectors.js";

export interface SystemLogInputs {
  integrations?: string[];
  exclude?: string[];
  level?: SystemLogLevel;
  detail: SystemLogDetailLevel;
}

/**
 * Validates every input but `start` before anything is read (specs/012-ha-system-log research
 * R4): `integrations` and `exclude` as integration selectors, `level` among the levels the
 * instance records, and `detail`.
 */
export function parseSystemLogInputs(input: {
  integrations?: readonly string[];
  exclude?: readonly string[];
  level?: string;
  detail?: SystemLogDetailLevel;
}): SystemLogInputs {
  const integrations = parseSelectors(
    input.integrations,
    "integration selector",
  );
  const exclude = parseSelectors(input.exclude, "integration selector");
  const level = input.level;
  if (
    level !== undefined &&
    !SYSTEM_LOG_LEVELS.includes(level as SystemLogLevel)
  ) {
    throw errors.inputInvalid(
      `level is "${level}", not warning, error, or critical`,
      "system_log",
    );
  }
  const detail = input.detail ?? "standard";
  if (detail !== "standard" && detail !== "summary") {
    throw errors.inputInvalid(
      `detail is "${String(detail)}", not summary or standard`,
      "system_log",
    );
  }
  return {
    ...(integrations === undefined ? {} : { integrations }),
    ...(exclude === undefined ? {} : { exclude }),
    ...(level === undefined ? {} : { level: level as SystemLogLevel }),
    detail,
  };
}
