/** What a tool needs from the instance, besides a supported version (specs/009-ha-ping R4). */
export interface ToolRequirements {
  /** The tool reads administrator data. */
  admin: boolean;
  /** Integrations that must be loaded, by name. */
  integrations: readonly string[];
}

/**
 * One entry per tool the server offers except `ha_ping`, in registration order. A new tool adds its
 * row here; `tool.test.ts` fails when a registered tool has none.
 */
export const REQUIREMENTS: Readonly<Record<string, ToolRequirements>> = {
  ha_snapshot: { admin: true, integrations: [] },
  ha_logbook_query: { admin: true, integrations: ["logbook", "recorder"] },
  ha_trace: { admin: true, integrations: ["trace"] },
};
