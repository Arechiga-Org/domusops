import { ENCODED_CONTEXT_ID } from "@domusops/schema";
import { errors } from "../errors.js";

const RUN_ID = /^[0-9a-f]{32}$/;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A run ID as the instance issues it: 32 lowercase hexadecimal characters (research R14). */
export function parseRunId(value: string): string {
  if (!RUN_ID.test(value)) {
    throw errors.selectionInvalid(
      "a run ID is 32 lowercase hexadecimal characters",
    );
  }
  return value;
}

/**
 * A context ID: a 26-character ULID, a compact ID as either tool emits it, or at most 64 printable
 * ASCII characters (an ID of another kind is matched exactly).
 */
export function parseContextId(value: string): string {
  if (
    ULID.test(value) ||
    ENCODED_CONTEXT_ID.test(value) ||
    /^[\x20-\x7e]{1,64}$/.test(value)
  ) {
    return value;
  }
  throw errors.selectionInvalid(
    "a context ID is a 26-character ULID, a compact ID, or at most 64 printable ASCII characters",
  );
}

/**
 * What identifies a context. The compact form of an ID is anchored to a different second in each
 * tool, so two IDs of one context differ in their offset; the last 16 characters (the random part
 * of a ULID) are the same (research R8). An ID of another kind is its own key, and can never
 * equal a ULID's.
 */
export function contextKey(id: string): string {
  if (ULID.test(id)) return `u:${id.slice(10)}`;
  if (ENCODED_CONTEXT_ID.test(id)) return `u:${id.slice(id.indexOf(":") + 1)}`;
  return `s:${id}`;
}

export function sameContext(a: string, b: string): boolean {
  return contextKey(a) === contextKey(b);
}

/** The millisecond timestamp of a full ULID, or `null` for any other ID. */
export function contextTimeMs(id: string): number | null {
  if (!ULID.test(id)) return null;
  let ms = 0;
  for (let i = 0; i < 10; i++) ms = ms * 32 + CROCKFORD.indexOf(id.charAt(i));
  return ms;
}
