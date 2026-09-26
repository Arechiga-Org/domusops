import {
  REDACTION_MARKER,
  type JsonObject,
  type RawRecords,
} from "@domusops/schema";

const M = REDACTION_MARKER;

/** Values of these keys are never redacted, at any depth (data-model §8). */
const EXEMPT_KEYS = new Set([
  "entity_id",
  "device_id",
  "area_id",
  "floor_id",
  "config_entry_id",
  "config_subentry_id",
  "entry_id",
  "via_device_id",
  "parent_device_id",
  "primary_config_entry",
  "config_entries",
  "humidity_entity_id",
  "temperature_entity_id",
]);

const CREDENTIAL_WORDS = new Set([
  "token",
  "tokens",
  "password",
  "passwords",
  "passwd",
  "secret",
  "secrets",
  "apikey",
  "credential",
  "credentials",
  "authorization",
  "bearer",
  "webhook",
  "webhooks",
]);
const CREDENTIAL_PAIRS = new Set([
  "api key",
  "private key",
  "secret key",
  "access key",
  "auth key",
  "encryption key",
]);
const COORDINATE_KEYS = new Set([
  "latitude",
  "longitude",
  "lat",
  "lon",
  "lng",
  "elevation",
]);
const QUERY_CREDENTIALS = new Set(["key", "sig", "signature", "auth"]);

/** Splits a key into lowercase words on separators and camelCase boundaries. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
}

function isCredentialName(name: string): boolean {
  const parts = words(name);
  if (parts.some((w) => CREDENTIAL_WORDS.has(w))) return true;
  for (let i = 0; i + 1 < parts.length; i++) {
    if (CREDENTIAL_PAIRS.has(`${parts[i]} ${parts[i + 1]}`)) return true;
  }
  return false;
}

const NUMBER_PAIR = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

function isNumericPair(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 2 && value.every((v) => typeof v === "number");
  }
  return typeof value === "string" && NUMBER_PAIR.test(value);
}

const URL_USER_INFO = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@?#]*:)([^\s/@?#]+)(@)/gi;
const QUERY_PARAMETER = /([?&;])([^=&#\s]+)=([^&#\s]*)/g;
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Rule C2: two decimals with at least three decimals each, separated by a comma or whitespace,
 * that could be a latitude and a longitude. The lookbehind stops a match from starting in the
 * middle of a longer number (an epoch timestamp, say).
 */
const COORDINATE_PAIR =
  /(?<![\d.])(-?\d{1,2}\.\d{3,})(?:\s*,\s*|\s+)(-?\d{1,3}\.\d{3,})(?!\d)/g;

/** What the redaction of one call needs besides the rules: the token and C3's matcher. */
interface Context {
  token: string;
  /** Rule C3: the instance's own latitude and longitude, as one pattern; null when none apply. */
  coordinates: RegExp | null;
}

/**
 * Rule C3 matcher for the instance's own coordinates. A value is used only when written with at
 * least three decimals: a shorter one (20.4) would match unrelated numbers. The unsigned form is
 * matched too, so "-103.4425" and "103.4425" are both caught.
 */
function coordinateMatcher(values: readonly unknown[]): RegExp | null {
  const forms: string[] = [];
  for (const value of values) {
    if (typeof value !== "number" && typeof value !== "string") continue;
    const text = String(value).trim().replace(/^[+-]/, "");
    if (/^\d+\.\d{3,}$/.test(text)) forms.push(text.replace(/\./g, "\\."));
  }
  return forms.length === 0
    ? null
    : new RegExp(`-?(?:${forms.join("|")})`, "g");
}

/** Rules V1 to V6, C2, and C3, applied to one string. The configured token goes first (V5). */
function redactString(text: string, ctx: Context): string {
  const { token } = ctx;
  let out = token === "" ? text : text.split(token).join(M);
  out = out.replace(URL_USER_INFO, `$1${M}$3`);
  out = out.replace(QUERY_PARAMETER, (all, lead: string, name: string) =>
    isCredentialName(name) || QUERY_CREDENTIALS.has(name.toLowerCase())
      ? `${lead}${name}=${M}`
      : all,
  );
  out = out.replace(JWT, M);
  out = out.replace(BEARER, `$1${M}`);
  out = out.replace(EMAIL, M);
  out = out.replace(COORDINATE_PAIR, (all, lat: string, lon: string) =>
    Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180 ? M : all,
  );
  if (ctx.coordinates !== null) out = out.replace(ctx.coordinates, M);
  return out;
}

function walk(
  value: unknown,
  key: string | null,
  ctx: Context,
  exempt: ReadonlySet<string>,
): unknown {
  if (key !== null) {
    if (exempt.has(key)) return value;
    if (isCredentialName(key)) return M;
    if (COORDINATE_KEYS.has(key.toLowerCase())) return M;
    if ((key === "gps" || key === "location") && isNumericPair(value)) return M;
  }
  if (typeof value === "string") return redactString(value, ctx);
  if (Array.isArray(value))
    return value.map((item) => walk(item, null, ctx, exempt));
  if (typeof value === "object" && value !== null)
    return walkObject(value as JsonObject, ctx, exempt);
  return value;
}

function walkObject(
  object: JsonObject,
  ctx: Context,
  exempt: ReadonlySet<string>,
): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(object))
    out[key] = walk(value, key, ctx, exempt);
  return out;
}

const DEVICE_EXEMPT = new Set([...EXEMPT_KEYS, "id"]);

/** Identifier keys of a logbook row that are never redacted (data-model §7 of feature 002). */
export const LOGBOOK_EXEMPT_KEYS: ReadonlySet<string> = new Set([
  "entity_id",
  "context_entity_id",
  "context_user_id",
  "context_id",
]);

export interface RedactRowsOptions {
  /** The configured access token, redacted wherever it occurs (rule V5). */
  token: string;
  /** Keys whose values are identifiers and are never touched, at any depth. */
  exemptKeys: ReadonlySet<string>;
  /** The instance's own coordinates, redacted wherever they occur in text (rule C3). */
  coordinates?: { latitude: unknown; longitude: unknown };
}

/**
 * Returns a deep copy of `rows` with secrets, credentials, coordinates, and e-mail addresses
 * replaced by the redaction marker. Fields are kept, so an agent can see that a value existed.
 */
export function redactRows<T extends JsonObject>(
  rows: readonly T[],
  options: RedactRowsOptions,
): T[] {
  const ctx: Context = {
    token: options.token,
    coordinates:
      options.coordinates === undefined
        ? null
        : coordinateMatcher([
            options.coordinates.latitude,
            options.coordinates.longitude,
          ]),
  };
  return rows.map((row) => walkObject(row, ctx, options.exemptKeys) as T);
}

/**
 * Returns a deep copy of the records with secrets, credentials, coordinates, and e-mail addresses
 * replaced by the redaction marker (data-model §8). Fields are kept, so an agent can see that a
 * value existed. Identifier fields on the closed exemption list are never touched.
 */
export function redact(
  records: RawRecords,
  configuredToken: string,
): RawRecords {
  const ctx: Context = {
    token: configuredToken,
    coordinates: coordinateMatcher([
      records.config["latitude"],
      records.config["longitude"],
    ]),
  };
  const plain = (record: JsonObject): JsonObject =>
    walkObject(record, ctx, EXEMPT_KEYS);
  return {
    config: plain(records.config),
    states: records.states.map((r) => plain(r) as RawRecords["states"][number]),
    entity_registry: records.entity_registry.map(
      (r) => plain(r) as RawRecords["entity_registry"][number],
    ),
    device_registry: records.device_registry.map(
      (r) =>
        walkObject(
          r,
          ctx,
          DEVICE_EXEMPT,
        ) as RawRecords["device_registry"][number],
    ),
    area_registry: records.area_registry.map(
      (r) => plain(r) as RawRecords["area_registry"][number],
    ),
    config_entries: records.config_entries.map(
      (r) => plain(r) as RawRecords["config_entries"][number],
    ),
  };
}
