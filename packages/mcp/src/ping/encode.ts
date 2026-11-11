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

/** The kinds of reason, in the order their sentences come (data-model §3). */
const KINDS = ["version_unsupported", "not_admin", "integration_missing"];

const kindOf = (reason: PingReason): string => reason.split(":")[0] as string;

/** The one sentence a reason maps to (data-model §3); `adminTools` are those that need an administrator. */
function nextStep(reason: PingReason, adminTools: readonly string[]): string {
  if (reason === "version_unsupported") {
    return `Upgrade the instance to ${MIN_VERSION} or later`;
  }
  if (reason === "not_admin") {
    return `Use a token of an administrator user, which ${adminTools.join(", ")} need`;
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

  const adminTools = Object.entries(requirements)
    .filter(([, need]) => need.admin)
    .map(([name]) => name);
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
    .sort(
      (a, b) =>
        KINDS.indexOf(kindOf(a)) - KINDS.indexOf(kindOf(b)) || byName(a, b),
    )
    .map((reason) => nextStep(reason, adminTools));

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
