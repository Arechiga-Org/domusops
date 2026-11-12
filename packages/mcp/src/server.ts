import {
  DETAIL_LEVELS,
  LOGBOOK_DETAIL_LEVELS,
  STATE_DETAIL_LEVELS,
  TRACE_DETAIL_LEVELS,
} from "@domusops/schema";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errors, ToolError } from "./errors.js";
import type { Timeouts } from "./ha/client.js";
import { MAX_SELECTORS } from "./logbook/selectors.js";
import {
  characterCount,
  DOMAIN,
  MAX_ATTRIBUTE_LENGTH,
  MAX_ENTRIES,
  MAX_STATE_LENGTH,
} from "./state/inputs.js";
import type { Response } from "./notes.js";
import { packageVersion, SERVER_NAME } from "./package-info.js";
import { queryLogbook } from "./tools/ha-logbook-query.js";
import { runSnapshot } from "./tools/ha-snapshot.js";
import { runPing } from "./tools/ha-ping.js";
import { queryState } from "./tools/ha-state.js";
import { queryTrace } from "./tools/ha-trace.js";

// Copied from specs/001-ha-snapshot/contracts/ha_snapshot.tool.json, the tool contract.
const DETAIL_DESCRIPTION =
  "summary: counts and topology only. standard: compressed full inventory. full: every field, including those standard omits (escape hatch; larger).";
const TITLE = "Inventory snapshot for Home Assistant";
const DESCRIPTION =
  "Read-only inventory of the connected Home Assistant instance: every entity (with current state and attributes), device, area, integration and config entry, plus the core version. Returned as compact JSON in the domusops.snapshot/0.1 format. detail=summary gives counts and topology only; standard (default) is grouped, templated and at least 5x smaller than the raw registries on a 500-entity reference instance (asserted in CI); full keeps every field, including those standard omits, in the same lossless encoding. Secrets and coordinates are always redacted. Every response reports its compression_ratio. Requires DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN (administrator user).";

// Copied from specs/008-mcp-reliability/contracts/ha_logbook_query.tool.json, the tool contract.
const LOGBOOK_TITLE = "Logbook history for Home Assistant";
const LOGBOOK_DESCRIPTION =
  "Read-only history of what happened on the connected Home Assistant instance: the logbook events in a time window, in order, each with its cause (the automation, script, service call, user, or entity behind it). Returned as compact JSON in the domusops.logbook/0.1 format, with event times in the instance's local time. start and end are ISO 8601 (no offset means the instance's time zone); the default window is the last 24 hours. entities takes exact entity IDs or * patterns (light.*, *_motion); without it, every event is returned, including instance start and stop. exclude takes the same IDs and patterns and leaves those entities out, after entities is applied; a note after the document lists what was excluded. detail=summary gives counts per entity, domain, and cause only; standard (default) lists every event and is at least 5x smaller than the raw logbook on a 24-hour reference window (asserted in CI). A standard result larger than 100000 bytes (DOMUSOPS_LOGBOOK_MAX_BYTES) is refused with the event count: use summary, a shorter window, fewer entities, or exclude. The logbook omits continuous sensors (with a unit of measurement) and history older than the instance's retention. Patterns follow the instance's logbook exclude settings; exact IDs do not. Secrets, coordinates, and e-mail addresses are always redacted. Every response reports its compression_ratio. Requires DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN (administrator user).";
const START_DESCRIPTION =
  "Window start, ISO 8601 (2026-09-26T03:00 or 2026-09-26T03:00:00-06:00). Default: 24 hours before end.";
const END_DESCRIPTION =
  "Window end, ISO 8601. Default: now. A later time is clamped to now.";
const LOGBOOK_DETAIL_DESCRIPTION =
  "summary: counts per entity, domain, and cause. standard: every event, compressed.";
const ENTITIES_DESCRIPTION =
  "Entity IDs or patterns where * matches anything (light.*, *_motion). Omit for every event.";
const EXCLUDE_DESCRIPTION =
  "Entity IDs or patterns to leave out, in the same form as entities (*_firmware, button.*). Applied after entities; events with no entity are never excluded.";

// Copied from specs/008-mcp-reliability/contracts/ha_trace.tool.json, the tool contract.
const TRACE_TITLE = "Automation and script traces for Home Assistant";
const TRACE_DESCRIPTION =
  "Read-only step-by-step traces of automation and script runs on the connected Home Assistant instance: what triggered each run, which conditions passed or failed, which branches and actions ran with which data, how long each step took, and where and why the run stopped. Also returns not-triggered traces (a trigger evaluated a change but did not fire), which explain why an automation did not run. Returned as compact JSON in the domusops.trace/0.1 format, with times in the instance's local time. entities takes automation or script entity IDs or * patterns (automation.*, script.*_lights); without it, every automation and script is considered. exclude takes the same IDs and patterns and leaves those automations and scripts out, after entities is applied. start and end (ISO 8601; no offset means the instance's time zone) keep only runs that started in that window; without them, every stored run is returned. run takes a run ID from an earlier response; context takes a context ID from a ha_trace or ha_logbook_query response (the cause of an event) and returns every run in that context. Two context IDs match when their last 16 characters are equal. detail=summary gives one row per run; standard (default) adds every step, variable, result, and the configuration the run executed, losslessly, and is at least 3x smaller than the raw traces on a reference set (asserted in CI). A result larger than 100000 bytes (DOMUSOPS_TRACE_MAX_BYTES) is refused with the run count: use summary, run, context, fewer entities, exclude, or a shorter window. The instance keeps only the last few runs per automation or script (5 by default), and only automations with an id are traced. When start or end is given and an automation or script has already replaced runs that may fall in the window, a note after the document names it (at most 10) with the number of runs it keeps; ha_logbook_query is the full history. Secrets, coordinates, and e-mail addresses are always redacted. Every response reports its compression_ratio. Requires DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN (administrator user).";
const TRACE_ENTITIES_DESCRIPTION =
  "Automation or script entity IDs, or patterns where * matches anything (automation.*, script.*_lights). Omit for every automation and script.";
const TRACE_EXCLUDE_DESCRIPTION =
  "Automation or script entity IDs or patterns to leave out, in the same form as entities. Applied after entities. Not combinable with run or context.";
const TRACE_START_DESCRIPTION =
  "Keep runs that started at or after this time, ISO 8601 (2026-09-26T03:00 or 2026-09-26T03:00:00-06:00). Default when end is given: 24 hours before end.";
const TRACE_END_DESCRIPTION =
  "Keep runs that started at or before this time, ISO 8601. Default when start is given: now.";
const TRACE_RUN_DESCRIPTION =
  "A run ID from an earlier ha_trace response (32 hexadecimal characters). Returns that run only. Not combinable with entities, exclude, start, end, or context.";
const TRACE_CONTEXT_DESCRIPTION =
  "A context ID from a ha_trace or ha_logbook_query response, or a full 26-character context ID. Returns every run in that context. Not combinable with entities, exclude, start, end, or run.";
const TRACE_DETAIL_DESCRIPTION =
  "summary: one row per run. standard: every step, compressed losslessly.";

/**
 * Runs one tool and turns its outcome into a result: the document first, then one text block per
 * note (specs/008-mcp-reliability research R2). Domain failures are tool results, not protocol
 * errors, so the agent always sees the remediation text; anything that is not already a
 * `ToolError` is reported as a protocol error. A failure carries no notes.
 */
async function asToolResult(
  tool: string,
  run: () => Promise<Response>,
): Promise<CallToolResult> {
  try {
    const { document, notes } = await run();
    return {
      content: [document, ...notes].map((text) => ({
        type: "text" as const,
        text,
      })),
    };
  } catch (error) {
    const failure =
      error instanceof ToolError
        ? error
        : errors.protocolError(
            error instanceof Error ? error.message : "unknown error",
          );
    return {
      isError: true,
      content: [{ type: "text", text: failure.toToolText(tool) }],
    };
  }
}

export interface ServerOptions {
  /** Environment the tool reads its configuration from on every call. Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  timeouts?: Partial<Timeouts>;
}

// Copied from specs/010-ha-state/contracts/ha_state.tool.json, the tool contract.
const STATE_TITLE = "Entity states for Home Assistant";
const STATE_DESCRIPTION =
  "Read-only current state of the entities of the connected Home Assistant instance: for each one its state, its attributes, when it last changed, was last updated and last reported, and the context of the change. Returned as compact JSON in the domusops.state/0.1 format, grouped by domain and templated, with times in the instance's local time. entities takes exact entity IDs or * patterns (light.*, *_motion); without it, every entity is considered. domain keeps only those domains (light, sensor); state keeps only entities whose state is one of the values given (on, unavailable). exclude takes the same IDs and patterns as entities and leaves those entities out, after the other filters; a note after the document lists what was excluded. attributes keeps only the attributes named (brightness, friendly_name) and never changes which entities are returned. An exact ID with no entity is named in a note, not an error. The context IDs (st.context, st.parent_id) can be passed to the context input of ha_trace and ha_logbook_query to see what caused a change. detail=summary gives, per domain, how many entities there are and how many are unavailable and unknown, and stays small for any home; standard (default) lists every selected entity and is at least 2x smaller than the raw states on a 500-entity reference instance (asserted in CI). A standard result larger than 100000 bytes (DOMUSOPS_STATE_MAX_BYTES) is refused with the entity count: use summary, entities, domain, state, exclude, or attributes. ha_snapshot is the full inventory with registries, devices and areas; this tool is the filtered live view. Secrets, coordinates, and e-mail addresses are always redacted. Every response reports its compression_ratio. Requires DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN (administrator user).";
const STATE_ENTITIES_DESCRIPTION =
  "Entity IDs or patterns with * (light.kitchen, light.*, *_battery). Without it, every entity is considered.";
const STATE_DOMAIN_DESCRIPTION =
  "Domains to keep (light, sensor). Combined with entities, an entity must match both.";
const STATE_STATE_DESCRIPTION =
  "State values to keep, compared exactly (on, off, unavailable, unknown).";
const STATE_EXCLUDE_DESCRIPTION =
  "Entity IDs or patterns to leave out, in the same form as entities (*_firmware, button.*). Applied after the other filters.";
const STATE_ATTRIBUTES_DESCRIPTION =
  "Attribute names to keep (brightness, friendly_name). Without it, every attribute is returned. Not combinable with detail=summary.";
const STATE_DETAIL_DESCRIPTION =
  "summary: counts per domain, with unavailable and unknown. standard (default): every selected entity with its state, attributes, times and context.";

/**
 * A non-empty string of at most `max` characters. zod's `max` counts UTF-16 units, so the limit is
 * checked in characters and advertised as `maxLength`, which JSON Schema also counts in characters.
 */
const withinCharacters = (max: number) =>
  z
    .string()
    .min(1)
    .refine((text) => characterCount(text) <= max, {
      message: `Must be at most ${max} characters`,
    })
    .meta({ maxLength: max });

// Copied from specs/009-ha-ping/contracts/ha_ping.tool.json, the tool contract.
const PING_TITLE = "Connection check for Home Assistant";
const PING_DESCRIPTION =
  "Read-only check of whether this server can work with the connected Home Assistant instance, before any real query. Reads only the current user's administrator flag and the instance's core configuration: no entities, registries, history or traces. Returns compact JSON in the domusops.ping/0.1 format: the server's name and version; the instance's version, the minimum this server supports, whether it is supported, and its time zone (start and end without an offset are read in it); whether the token's user is an administrator; which integrations the other tools need are loaded; and, for every other tool, whether it is ready and, if not, why (version_unsupported, not_admin, integration_missing:<name>), with next_steps saying what to change. A missing configuration, an unreachable address, a refused token or a timeout is an error result with the same remediation as the other tools. The token, the instance's address and location, and user names are never returned. Every response reports its compression_ratio. Requires DOMUSOPS_HA_URL and DOMUSOPS_HA_TOKEN.";

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: packageVersion(),
  });

  server.registerTool(
    "ha_snapshot",
    {
      title: TITLE,
      description: DESCRIPTION,
      inputSchema: {
        detail: z
          .enum(DETAIL_LEVELS)
          .default("standard")
          .describe(DETAIL_DESCRIPTION),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ detail }) =>
      asToolResult("ha_snapshot", async () => ({
        document: await runSnapshot(options.env ?? process.env, {
          detail,
          ...(options.timeouts === undefined
            ? {}
            : { timeouts: options.timeouts }),
        }),
        notes: [],
      })),
  );

  server.registerTool(
    "ha_logbook_query",
    {
      title: LOGBOOK_TITLE,
      description: LOGBOOK_DESCRIPTION,
      inputSchema: {
        start: z.string().optional().describe(START_DESCRIPTION),
        end: z.string().optional().describe(END_DESCRIPTION),
        detail: z
          .enum(LOGBOOK_DETAIL_LEVELS)
          .default("standard")
          .describe(LOGBOOK_DETAIL_DESCRIPTION),
        entities: z
          .array(z.string())
          .min(1)
          .max(MAX_SELECTORS)
          .optional()
          .describe(ENTITIES_DESCRIPTION),
        exclude: z
          .array(z.string())
          .min(1)
          .max(MAX_SELECTORS)
          .optional()
          .describe(EXCLUDE_DESCRIPTION),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        // The default window is the last 24 hours, so two calls cover different periods.
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ start, end, entities, exclude, detail }) =>
      asToolResult("ha_logbook_query", () =>
        queryLogbook(options.env ?? process.env, {
          detail,
          ...(start === undefined ? {} : { start }),
          ...(end === undefined ? {} : { end }),
          ...(entities === undefined ? {} : { entities }),
          ...(exclude === undefined ? {} : { exclude }),
          ...(options.timeouts === undefined
            ? {}
            : { timeouts: options.timeouts }),
        }),
      ),
  );

  server.registerTool(
    "ha_trace",
    {
      title: TRACE_TITLE,
      description: TRACE_DESCRIPTION,
      inputSchema: {
        entities: z
          .array(z.string())
          .min(1)
          .max(MAX_SELECTORS)
          .optional()
          .describe(TRACE_ENTITIES_DESCRIPTION),
        exclude: z
          .array(z.string())
          .min(1)
          .max(MAX_SELECTORS)
          .optional()
          .describe(TRACE_EXCLUDE_DESCRIPTION),
        start: z.string().optional().describe(TRACE_START_DESCRIPTION),
        end: z.string().optional().describe(TRACE_END_DESCRIPTION),
        run: z.string().optional().describe(TRACE_RUN_DESCRIPTION),
        context: z.string().optional().describe(TRACE_CONTEXT_DESCRIPTION),
        detail: z
          .enum(TRACE_DETAIL_LEVELS)
          .default("standard")
          .describe(TRACE_DETAIL_DESCRIPTION),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        // New runs replace stored ones between calls.
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ entities, exclude, start, end, run, context, detail }) =>
      asToolResult("ha_trace", () =>
        queryTrace(options.env ?? process.env, {
          detail,
          ...(entities === undefined ? {} : { entities }),
          ...(exclude === undefined ? {} : { exclude }),
          ...(start === undefined ? {} : { start }),
          ...(end === undefined ? {} : { end }),
          ...(run === undefined ? {} : { run }),
          ...(context === undefined ? {} : { context }),
          ...(options.timeouts === undefined
            ? {}
            : { timeouts: options.timeouts }),
        }),
      ),
  );

  server.registerTool(
    "ha_state",
    {
      title: STATE_TITLE,
      description: STATE_DESCRIPTION,
      inputSchema: {
        entities: z
          .array(z.string())
          .min(1)
          .max(MAX_SELECTORS)
          .optional()
          .describe(STATE_ENTITIES_DESCRIPTION),
        domain: z
          .array(z.string().regex(DOMAIN))
          .min(1)
          .max(MAX_ENTRIES)
          .optional()
          .describe(STATE_DOMAIN_DESCRIPTION),
        state: z
          .array(withinCharacters(MAX_STATE_LENGTH))
          .min(1)
          .max(MAX_ENTRIES)
          .optional()
          .describe(STATE_STATE_DESCRIPTION),
        exclude: z
          .array(z.string())
          .min(1)
          .max(MAX_SELECTORS)
          .optional()
          .describe(STATE_EXCLUDE_DESCRIPTION),
        attributes: z
          .array(withinCharacters(MAX_ATTRIBUTE_LENGTH))
          .min(1)
          .max(MAX_ENTRIES)
          .optional()
          .describe(STATE_ATTRIBUTES_DESCRIPTION),
        detail: z
          .enum(STATE_DETAIL_LEVELS)
          .default("standard")
          .describe(STATE_DETAIL_DESCRIPTION),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ entities, domain, state, exclude, attributes, detail }) =>
      asToolResult("ha_state", () =>
        queryState(options.env ?? process.env, {
          detail,
          ...(entities === undefined ? {} : { entities }),
          ...(domain === undefined ? {} : { domain }),
          ...(state === undefined ? {} : { state }),
          ...(exclude === undefined ? {} : { exclude }),
          ...(attributes === undefined ? {} : { attributes }),
          ...(options.timeouts === undefined
            ? {}
            : { timeouts: options.timeouts }),
        }),
      ),
  );

  server.registerTool(
    "ha_ping",
    {
      title: PING_TITLE,
      description: PING_DESCRIPTION,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () =>
      asToolResult("ha_ping", async () => ({
        document: await runPing(options.env ?? process.env, {
          ...(options.timeouts === undefined
            ? {}
            : { timeouts: options.timeouts }),
        }),
        notes: [],
      })),
  );

  return server;
}
