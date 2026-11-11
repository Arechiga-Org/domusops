import {
  PING_FORMAT,
  type PingDocument,
  type PingReason,
} from "@domusops/schema";
import { isSupported, MIN_VERSION } from "../ha/version.js";
import { SERVER_NAME } from "../package-info.js";
import { finalize } from "../snapshot/ratio.js";
import { REQUIREMENTS, type ToolRequirements } from "./requirements.js";

/** What `ha_ping` learned from the instance, and what the two answers weighed. */
export interface PingInput {
  serverVersion: string;
  instanceVersion: string;
  timeZone: string;
  admin: boolean;
  /** The loaded integrations, from `get_config`. */
  components: readonly string[];
  /** Bytes of the two answers as received, for the compression ratio. */
  rawBytes: number;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The one sentence a reason maps to (data-model §3). */
function nextStep(reason: PingReason): string {
  if (reason === "version_unsupported") {
    return `Upgrade the instance to ${MIN_VERSION} or later`;
  }
  if (reason === "not_admin") {
    return "Use a token of an administrator user: every tool reads administrator data";
  }
  const name = reason.slice("integration_missing:".length);
  return `Enable the ${name} integration in Home Assistant (it is part of default_config), then try again`;
}

/**
 * The minified `domusops.ping/0.1` document (data-model §1 to §3). Tools come from
 * `requirements`, the real table by default; tests pass their own.
 */
export function encodePing(
  input: PingInput,
  requirements: Readonly<Record<string, ToolRequirements>> = REQUIREMENTS,
): string {
  const loaded = new Set(input.components);
  const supported = isSupported(input.instanceVersion);
  const needed = [
    ...new Set(
      Object.values(requirements).flatMap((tool) => [...tool.integrations]),
    ),
  ].sort(byName);

  const tools: PingDocument["tools"] = {};
  const distinct = new Set<PingReason>();
  for (const [name, need] of Object.entries(requirements)) {
    const reasons: PingReason[] = [];
    if (!supported) reasons.push("version_unsupported");
    if (need.admin && !input.admin) reasons.push("not_admin");
    for (const integration of [...need.integrations].sort(byName)) {
      if (!loaded.has(integration)) {
        reasons.push(`integration_missing:${integration}`);
      }
    }
    tools[name] =
      reasons.length === 0 ? { ready: true } : { ready: false, reasons };
    for (const reason of reasons) distinct.add(reason);
  }

  // Version first, then administrator, then each missing integration in name order.
  const steps = [...distinct]
    .sort((a, b) => rank(a) - rank(b) || byName(a, b))
    .map(nextStep);

  const document: PingDocument = {
    format: PING_FORMAT,
    server: { name: SERVER_NAME, version: input.serverVersion },
    instance: {
      version: input.instanceVersion,
      minimum: MIN_VERSION,
      supported,
      time_zone: input.timeZone,
    },
    admin: input.admin,
    integrations: Object.fromEntries(
      needed.map((name) => [name, loaded.has(name)]),
    ),
    tools,
    ...(steps.length === 0 ? {} : { next_steps: steps }),
    compression_ratio: 0,
  };
  return finalize(document, input.rawBytes);
}

function rank(reason: PingReason): number {
  return reason === "version_unsupported" ? 0 : reason === "not_admin" ? 1 : 2;
}
