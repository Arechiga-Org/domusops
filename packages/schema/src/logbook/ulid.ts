const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** The shape of an encoded context ID: a signed integer offset, a colon, 16 characters. */
export const ENCODED_CONTEXT_ID = /^-?\d+:[0-9A-HJKMNP-TV-Z]{16}$/;

function timestampOf(id: string): number {
  let ms = 0;
  for (let i = 0; i < 10; i++) ms = ms * 32 + ALPHABET.indexOf(id.charAt(i));
  return ms;
}

function timestampText(ms: number): string {
  let out = "";
  let rest = ms;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/**
 * Compact form of a context ID (data-model §3.2). A 26-character ULID becomes
 * `"<offset>:<last 16 characters>"`, where `offset` is its millisecond timestamp minus
 * `secondStartMs`. Any other string is returned verbatim, except one that already looks like an
 * encoded ID: that is wrapped as `{ v: value }` so decoding stays unambiguous.
 */
export function encodeContextId(
  id: string,
  secondStartMs: number,
): string | { v: string } {
  if (ULID.test(id)) {
    return `${timestampOf(id) - secondStartMs}:${id.slice(10)}`;
  }
  return ENCODED_CONTEXT_ID.test(id) ? { v: id } : id;
}

/** Inverse of `encodeContextId` for the string form; any other string is returned unchanged. */
export function decodeContextId(
  encoded: string,
  secondStartMs: number,
): string {
  if (!ENCODED_CONTEXT_ID.test(encoded)) return encoded;
  const colon = encoded.indexOf(":");
  const ms = secondStartMs + Number(encoded.slice(0, colon));
  return timestampText(ms) + encoded.slice(colon + 1);
}
