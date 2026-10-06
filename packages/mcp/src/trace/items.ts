import type { TraceDomain } from "@domusops/schema";
import type { KnownItems } from "../ha/trace.js";

/** The traced items the instance knows, and how a trace maps to one (research R3). */
export interface ItemResolver {
  /**
   * The key a trace's item has in the document: its entity ID when the registry knows it, else
   * `<domain>:<item_id>` (a removed item). The colon cannot appear in an entity ID.
   */
  keyOf(domain: string, itemId: string): string;
  /** The item ID of an entity-ID key, for the document's `ids` map. */
  itemIdOf(entityId: string): string | undefined;
  /** Entity IDs of every automation and script with a registry entry, in registry order. */
  registered: readonly string[];
  /** Entity IDs of automations without an `id`: known, never traced. */
  untraceable: ReadonlySet<string>;
}

export function resolveItems(known: KnownItems): ItemResolver {
  const byTrace = new Map<string, string>();
  const byEntity = new Map<string, string>();
  for (const entry of known.registry) {
    byTrace.set(`${entry.platform}\u0000${entry.unique_id}`, entry.entity_id);
    byEntity.set(entry.entity_id, entry.unique_id);
  }
  return {
    keyOf: (domain, itemId) =>
      byTrace.get(`${domain}\u0000${itemId}`) ?? `${domain}:${itemId}`,
    itemIdOf: (entityId) => byEntity.get(entityId),
    registered: known.registry.map((entry) => entry.entity_id),
    untraceable: new Set(known.untraceable),
  };
}

/** The domain of an item key: an entity ID's part before the dot, or a removed item's before the colon. */
export function domainOfKey(key: string): TraceDomain | string {
  const colon = key.indexOf(":");
  return colon >= 0 ? key.slice(0, colon) : (key.split(".")[0] as string);
}

/** Splits an item key back into the domain and item ID of a trace. */
export function splitKey(
  key: string,
  itemIdOf: (entityId: string) => string | undefined,
): { domain: string; itemId: string } {
  const colon = key.indexOf(":");
  if (colon >= 0)
    return { domain: key.slice(0, colon), itemId: key.slice(colon + 1) };
  const dot = key.indexOf(".");
  return {
    domain: key.slice(0, dot),
    itemId: itemIdOf(key) ?? key.slice(dot + 1),
  };
}
