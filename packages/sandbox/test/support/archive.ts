import { Parser } from "tar";

export interface ArchiveEntry {
  type: string;
  content: string;
  linkpath: string | undefined;
}

/** Every entry of a tar archive, by path. */
export async function readArchive(
  archive: Buffer,
): Promise<Map<string, ArchiveEntry>> {
  const out = new Map<string, ArchiveEntry>();
  const parser = new Parser();
  parser.on("entry", (entry) => {
    const chunks: Buffer[] = [];
    entry.on("data", (chunk: Buffer) => chunks.push(chunk));
    entry.on("end", () =>
      out.set(entry.path.replace(/\/$/, ""), {
        type: entry.type,
        content: Buffer.concat(chunks).toString("utf8"),
        linkpath: entry.linkpath,
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    parser.on("end", resolve);
    parser.on("error", reject);
    parser.end(archive);
  });
  return out;
}
