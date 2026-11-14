import type { SystemLogDetailLevel } from "@domusops/schema";
import { errors } from "../errors.js";
import { HaClient, type Timeouts } from "../ha/client.js";
import { readConfig, readSystemLogLimit } from "../ha/config.js";
import { readCore, readCurrentUser } from "../ha/instance.js";
import { readSystemLog } from "../ha/system-log.js";
import { parseWindowInput, resolveWindow } from "../logbook/window.js";
import {
  emptyLogNote,
  exclusionNote,
  noEntryMatchedNote,
  type Response,
} from "../notes.js";
import { byteLength, finalize } from "../snapshot/ratio.js";
import { redactText } from "../snapshot/redact.js";
import { encodeStandardSystemLog } from "../system-log/encode-standard.js";
import { encodeSummarySystemLog } from "../system-log/encode-summary.js";
import {
  classify,
  customIntegrations,
  prepareEntry,
  selectEntries,
} from "../system-log/entries.js";
import { systemLogFrame } from "../system-log/envelope.js";
import { parseSystemLogInputs } from "../system-log/inputs.js";
import { rootPaths } from "../system-log/paths.js";

export interface SystemLogOptions {
  /** Defaults to `standard`. */
  detail?: SystemLogDetailLevel;
  /** Integration domains and patterns to keep. */
  integrations?: string[];
  /** Integration domains and patterns left out after `integrations`. */
  exclude?: string[];
  /** The minimum level: `warning`, `error` or `critical`. */
  level?: string;
  /** ISO 8601; keeps the entries whose last occurrence is at or after it. */
  start?: string | undefined;
  timeouts?: Partial<Timeouts>;
  /** The time of the call, in epoch milliseconds. Defaults to the clock; tests pin it. */
  now?: number;
}

/** The minified document of a `ha_system_log` call, without its notes. Throws a `ToolError`. */
export async function runSystemLog(
  env: Readonly<Record<string, string | undefined>>,
  options: SystemLogOptions = {},
): Promise<string> {
  return (await querySystemLog(env, options)).document;
}

/**
 * The whole `ha_system_log` pipeline (specs/012-ha-system-log): configuration, input validation,
 * one connection, the administrator and integration checks, `start`, one system log read,
 * attribution, the filters, re-rooting, redaction and encoding. Resolves with the minified
 * document and the notes that follow it, or throws a `ToolError`.
 */
export async function querySystemLog(
  env: Readonly<Record<string, string | undefined>>,
  options: SystemLogOptions = {},
): Promise<Response> {
  const config = readConfig(env);
  // Everything that can be checked without the instance is checked before connecting.
  const now = options.now ?? Date.now();
  const inputs = parseSystemLogInputs({
    ...(options.integrations === undefined
      ? {}
      : { integrations: options.integrations }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  });
  const parsedStart =
    options.start === undefined
      ? null
      : parseWindowInput({ start: options.start });
  const limit = readSystemLogLimit(env);

  const client = await HaClient.connect({
    wsUrl: config.wsUrl,
    token: config.token,
    ...(options.timeouts === undefined ? {} : { timeouts: options.timeouts }),
  });
  try {
    // The user and the core config are read together; nothing else is read for a user who is not
    // an administrator (research R2). The reads settle in the order they are sent.
    const current = readCurrentUser(client);
    const core = readCore(client);
    core.catch(() => undefined);
    const user = await current;
    if (!user.isAdmin) throw errors.notAdmin("required");
    const { instance } = await core;
    if (!instance.components.includes("system_log")) {
      throw errors.systemLogUnavailable();
    }
    const { configDir } = instance;
    if (configDir === undefined) {
      throw errors.protocolError(
        "the core config has no configuration directory",
        instance.haVersion,
      );
    }
    // `start` is the start of a window that ends now, so its errors are the logbook's (R4).
    const startMs =
      parsedStart === null
        ? undefined
        : resolveWindow(parsedStart, now, instance.timeZone).startMs;

    const raw = await readSystemLog(client);
    const selected = selectEntries(raw.map(classify), {
      ...(inputs.integrations === undefined
        ? {}
        : { integrations: inputs.integrations }),
      ...(inputs.exclude === undefined ? {} : { exclude: inputs.exclude }),
      ...(inputs.level === undefined ? {} : { level: inputs.level }),
      ...(startMs === undefined ? {} : { startMs }),
    });
    const frame = systemLogFrame({
      detail: inputs.detail,
      haVersion: instance.haVersion,
      timeZone: instance.timeZone,
      nowMs: now,
      ...(inputs.integrations === undefined
        ? {}
        : { integrations: inputs.integrations }),
      ...(inputs.level === undefined ? {} : { level: inputs.level }),
      ...(startMs === undefined ? {} : { startMs }),
      custom: customIntegrations(selected),
    });

    const notes: string[] = [];
    if (inputs.exclude !== undefined) notes.push(exclusionNote(inputs.exclude));
    if (raw.length === 0) notes.push(emptyLogNote());
    else if (selected.length === 0) notes.push(noEntryMatchedNote());

    // The raw size is that of the selected entries as received (research R12).
    const rawBytes = byteLength(JSON.stringify(selected.map((e) => e.raw)));
    if (inputs.detail === "summary") {
      // The summary carries no message, source or traceback, so nothing in it needs redaction.
      const text = finalize(encodeSummarySystemLog(frame, selected), rawBytes);
      const bytes = byteLength(text);
      if (bytes > limit) {
        throw errors.tooLargeSystemLog(
          selected.length,
          bytes,
          limit,
          "summary",
        );
      }
      return { document: text, notes };
    }

    const roots = rootPaths(configDir);
    const redact = redactText({
      token: config.token,
      coordinates: {
        latitude: instance.latitude,
        longitude: instance.longitude,
      },
    });
    const prepared = selected.map((entry) =>
      prepareEntry(entry, roots, redact),
    );
    const text = finalize(encodeStandardSystemLog(frame, prepared), rawBytes);
    // A result above the limit is an error, never a truncated result (FR-010).
    const bytes = byteLength(text);
    if (bytes > limit) {
      throw errors.tooLargeSystemLog(selected.length, bytes, limit, "standard");
    }
    return { document: text, notes };
  } finally {
    client.close();
  }
}
