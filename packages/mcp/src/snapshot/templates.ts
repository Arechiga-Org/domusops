import {
  deepEqual,
  type Groups,
  type JsonObject,
  type Template,
} from "@domusops/schema";

/**
 * One row to encode: leading identity values, plus the flat fields that follow them. `defaults`
 * lists the keys this record may omit (its field equals the default) and what that default is; it
 * only has an effect on keys that are absent from `fields`.
 */
export interface Item {
  head: unknown[];
  headKeys: readonly string[];
  fields: JsonObject;
  defaults: JsonObject;
}

/** A shape held by at least this many records keeps its own template. */
const OWN_TEMPLATE_MIN = 3;
/** A partition is only split by a column value when it has at least this many rows. */
const SPLIT_MIN_ROWS = 4;
/** Columns with more distinct values than this are never split on. */
const SPLIT_MAX_VALUES = 16;

const size = (value: unknown): number => JSON.stringify(value).length;

const isDefaultable = (item: Item, key: string): boolean =>
  Object.hasOwn(item.defaults, key);

/** The keys that define a record's shape: those that never have a default. */
function shapeOf(item: Item): string[] {
  return Object.keys(item.fields)
    .filter((key) => !isDefaultable(item, key))
    .sort();
}

interface Leaf {
  core: string[];
  members: Item[];
}

interface Built {
  template: Template;
  rows: unknown[][];
}

/**
 * Builds a template and its rows for members that all contain every key of `core`. Keys that have
 * a default become columns when any member holds a non-default value (the others fill in their
 * default), and are left out entirely when every member holds its default.
 */
function build(core: readonly string[], members: readonly Item[]): Built {
  const columns = new Set(core);
  for (const member of members) {
    for (const key of Object.keys(member.fields)) {
      if (isDefaultable(member, key)) columns.add(key);
    }
  }
  const valueOf = (member: Item, key: string): unknown =>
    Object.hasOwn(member.fields, key)
      ? member.fields[key]
      : member.defaults[key];

  const first = members[0] as Item;
  const constant: JsonObject = {};
  const cols: string[] = [];
  for (const key of [...columns].sort()) {
    const value = valueOf(first, key);
    if (!members.every((m) => deepEqual(valueOf(m, key), value)))
      cols.push(key);
    else if (
      !members.every(
        (m) => isDefaultable(m, key) && deepEqual(value, m.defaults[key]),
      )
    ) {
      constant[key] = value;
    }
  }

  const rows = members.map((member) => {
    const row: unknown[] = [
      ...member.head,
      ...cols.map((c) => valueOf(member, c)),
    ];
    const extras: JsonObject = {};
    for (const key of Object.keys(member.fields).sort()) {
      if (!columns.has(key)) extras[key] = member.fields[key];
    }
    if (Object.keys(extras).length > 0) row.push(extras);
    return row;
  });
  return { template: { const: constant, cols }, rows };
}

/** Estimated encoded size of a leaf: its template definition plus its rows. */
function cost(core: readonly string[], members: readonly Item[]): number {
  const { template, rows } = build(core, members);
  return size(template) + 8 + rows.reduce((sum, row) => sum + size(row) + 1, 0);
}

/**
 * Splits a partition by the value of one column when that shrinks the output, so that columns
 * correlated with it become constants of each part. Recurses on the parts.
 */
function refine(leaf: Leaf): Leaf[] {
  const { core, members } = leaf;
  if (members.length < SPLIT_MIN_ROWS) return [leaf];

  const { template } = build(core, members);
  const valueOf = (member: Item, key: string): unknown =>
    Object.hasOwn(member.fields, key)
      ? member.fields[key]
      : member.defaults[key];
  let best: { cost: number; parts: Leaf[] } | null = null;
  const baseline = cost(core, members);
  for (const column of template.cols) {
    const byValue = new Map<string, Item[]>();
    for (const member of members) {
      const key = JSON.stringify(valueOf(member, column));
      const bucket = byValue.get(key);
      if (bucket === undefined) byValue.set(key, [member]);
      else bucket.push(member);
    }
    if (byValue.size < 2 || byValue.size > SPLIT_MAX_VALUES) continue;
    const parts = [...byValue.values()].map((m) => ({ core, members: m }));
    const total = parts.reduce(
      (sum, part) => sum + cost(core, part.members),
      0,
    );
    if (best === null || total < best.cost) best = { cost: total, parts };
  }
  if (best === null || best.cost >= baseline) return [leaf];
  return best.parts.flatMap((part) => refine(part));
}

/**
 * Builds the shared `templates` section. Records in a group are partitioned by shape (the set of
 * their keys that have no default). A shape shared by enough records becomes a template core;
 * records with a superset shape join it and carry their additional keys in a trailing "extras"
 * object. Within a template, keys with one value are constants and the rest are positional
 * columns; a partition is split by a column's value when that saves space. Records that fit no
 * template are emitted inline. Identical templates are shared across groups.
 */
export class TemplateBook {
  readonly defs: Record<string, Template> = {};
  private readonly byContent = new Map<string, string>();
  private counter = 0;

  private intern(template: Template): string {
    const content = JSON.stringify(template);
    const existing = this.byContent.get(content);
    if (existing !== undefined) return existing;
    const key = `t${++this.counter}`;
    this.defs[key] = template;
    this.byContent.set(content, key);
    return key;
  }

  /** `items` must already be in their final order; rows keep that order within a template. */
  group(items: readonly Item[]): Groups {
    const position = new Map(items.map((item, i) => [item, i]));
    const byOrder = (a: Item, b: Item): number =>
      (position.get(a) ?? 0) - (position.get(b) ?? 0);

    const shapes = new Map<string, { keys: string[]; members: Item[] }>();
    for (const item of items) {
      const keys = shapeOf(item);
      const id = JSON.stringify(keys);
      const shape = shapes.get(id);
      if (shape === undefined) shapes.set(id, { keys, members: [item] });
      else shape.members.push(item);
    }

    // Hosts are shapes frequent enough to keep their own template; smaller shapes join the host
    // with the most keys that they contain, and otherwise stand alone or go inline.
    const hosts = [...shapes.values()]
      .filter((s) => s.members.length >= OWN_TEMPLATE_MIN)
      .sort(
        (a, b) =>
          b.keys.length - a.keys.length || b.members.length - a.members.length,
      );
    const leaves = new Map<string, Leaf>();
    const inline: Item[] = [];
    for (const shape of shapes.values()) {
      const contains = (host: { keys: string[] }): boolean =>
        host.keys.every((k) => shape.keys.includes(k));
      const host =
        shape.members.length >= OWN_TEMPLATE_MIN ? shape : hosts.find(contains);
      const target = host ?? (shape.members.length >= 2 ? shape : undefined);
      if (target === undefined) {
        inline.push(...shape.members);
        continue;
      }
      const id = JSON.stringify(target.keys);
      const leaf = leaves.get(id) ?? { core: target.keys, members: [] };
      leaves.set(id, leaf);
      leaf.members.push(...shape.members);
    }

    const out: Groups = {};
    for (const leaf of leaves.values()) {
      leaf.members.sort(byOrder);
      for (const part of refine(leaf)) {
        const { template, rows } = build(part.core, part.members);
        const key = this.intern(template);
        const bucket = out[key] ?? (out[key] = []);
        bucket.push(...rows);
      }
    }
    if (inline.length > 0) {
      inline.sort(byOrder);
      out["_"] = inline.map(inlineObject);
    }
    return out;
  }
}

/** Null head values are left out of an inline object; decoding reads an absent key as null. */
function inlineObject(item: Item): JsonObject {
  const out: JsonObject = {};
  item.headKeys.forEach((key, i) => {
    const value = item.head[i];
    if (value !== null && value !== undefined) out[key] = value;
  });
  for (const key of Object.keys(item.fields).sort())
    out[key] = item.fields[key];
  return out;
}
