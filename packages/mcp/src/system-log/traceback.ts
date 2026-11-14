import type { SystemLogFrame, SystemLogPart } from "@domusops/schema";

/** One piece of a traceback: a frame with its indented lines, or any other line. */
export type TracebackItem =
  | { kind: "frame"; file: string; line: number; fn: string; code?: string }
  | { kind: "line"; text: string };

/**
 * A frame's `File` line. The line number has no leading zero, so the decoder rebuilds the text
 * exactly; anything else stays a plain line.
 */
const FRAME = /^ {2}File "(.*)", line ([1-9]\d*|0), in (.*)$/;
/** The source and caret lines Python prints under a frame. */
const CODE = /^ {4}/;

/** The frames and the other lines of a traceback, in order (research R6). */
export function splitTraceback(text: string): TracebackItem[] {
  const lines = text.split("\n");
  const items: TracebackItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const frame = FRAME.exec(line);
    if (frame === null) {
      items.push({ kind: "line", text: line });
      continue;
    }
    let end = i + 1;
    while (end < lines.length && CODE.test(lines[end] as string)) end++;
    const code = lines.slice(i + 1, end).join("\n");
    items.push({
      kind: "frame",
      file: frame[1] as string,
      line: Number(frame[2]),
      fn: frame[3] as string,
      ...(end > i + 1 ? { code } : {}),
    });
    i = end - 1;
  }
  return items;
}

/**
 * The shared tables of a standard document (research R6): `files`, every source and frame path
 * once, and `parts`, every distinct frame and every non-empty traceback line the document uses
 * more than once, each in order of first use. A line used once stays inline in its traceback,
 * joined with the inline lines next to it.
 */
export class PartTable {
  readonly files: string[] = [];
  readonly parts: SystemLogPart[] = [];
  private readonly fileIndex = new Map<string, number>();
  private readonly partIndex = new Map<string, number>();
  private readonly lineUses = new Map<string, number>();

  /** `tracebacks` are every traceback of the document, split, so repeated lines are known. */
  constructor(tracebacks: readonly (readonly TracebackItem[])[]) {
    for (const items of tracebacks) {
      for (const item of items) {
        if (item.kind === "line" && item.text !== "") {
          this.lineUses.set(item.text, (this.lineUses.get(item.text) ?? 0) + 1);
        }
      }
    }
  }

  file(path: string): number {
    let index = this.fileIndex.get(path);
    if (index === undefined) {
      index = this.files.length;
      this.files.push(path);
      this.fileIndex.set(path, index);
    }
    return index;
  }

  private part(key: string, make: () => SystemLogPart): number {
    let index = this.partIndex.get(key);
    if (index === undefined) {
      index = this.parts.length;
      this.parts.push(make());
      this.partIndex.set(key, index);
    }
    return index;
  }

  /** A traceback's items: part indexes, and strings of the lines used once. */
  items(traceback: readonly TracebackItem[]): (number | string)[] {
    const out: (number | string)[] = [];
    for (const item of traceback) {
      if (item.kind === "frame") {
        const { file, line, fn, code } = item;
        out.push(
          this.part(JSON.stringify(["f", file, line, fn, code ?? null]), () => {
            const frame: SystemLogFrame =
              code === undefined
                ? [this.file(file), line, fn]
                : [this.file(file), line, fn, code];
            return frame;
          }),
        );
      } else if ((this.lineUses.get(item.text) ?? 0) > 1) {
        out.push(this.part(JSON.stringify(["l", item.text]), () => item.text));
      } else {
        const last = out.at(-1);
        if (typeof last === "string")
          out[out.length - 1] = `${last}\n${item.text}`;
        else out.push(item.text);
      }
    }
    return out;
  }
}
