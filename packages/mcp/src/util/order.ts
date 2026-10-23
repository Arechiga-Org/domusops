/**
 * Orders `[key, count, ...]` entries by count, largest first, then by key by code point. Every
 * list that is ranked by use (strings of a table, domains, entities, causes) sorts this way, so
 * two runs over the same data always give the same order.
 */
export function byCountThenKey(
  a: readonly [string, number, ...unknown[]],
  b: readonly [string, number, ...unknown[]],
): number {
  return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}
