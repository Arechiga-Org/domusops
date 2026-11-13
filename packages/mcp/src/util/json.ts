/**
 * True for a plain JSON object: not `null`, not an array. The type parameter lets a caller that
 * works with a narrower object type keep it (`isObject<JsonObject>(value)`); it is a promise by the
 * caller, as with any type guard.
 */
export function isObject<T extends object = Record<string, unknown>>(
  value: unknown,
): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A number as text, left-padded with zeros to `width` characters. */
export const pad = (n: number, width = 2): string =>
  String(n).padStart(width, "0");

/**
 * Sets `key` as an own property of `target` even when it is `__proto__`, which plain assignment
 * would turn into a prototype change and lose.
 */
export function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
