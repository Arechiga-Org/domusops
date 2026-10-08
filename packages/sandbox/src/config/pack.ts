import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { Header, Pack, ReadEntry } from "tar";

/** Where the instance's configuration lives inside the container. */
export const CONFIG_ROOT = "config";

export const COMPANION_DOMAIN = "domusops_sandbox";

export const BASELINE_CONFIGURATION = `default_config:

${COMPANION_DOMAIN}:
`;

/** Builds a tar archive in memory: nothing is written to the host. */
export class TarBuilder {
  private readonly pack = new Pack({ portable: true });
  private readonly chunks: Buffer[] = [];
  private readonly finished: Promise<void>;

  constructor() {
    this.pack.on("data", (chunk: Buffer) => this.chunks.push(chunk));
    this.finished = new Promise((resolve, reject) => {
      this.pack.on("end", resolve);
      this.pack.on("error", reject);
    });
  }

  addDirectory(path: string, mode = 0o755): void {
    this.add(`${path}/`, Buffer.alloc(0), mode, "Directory");
  }

  addFile(path: string, data: Buffer | string, mode = 0o644): void {
    this.add(
      path,
      typeof data === "string" ? Buffer.from(data) : data,
      mode,
      "File",
    );
  }

  async finish(): Promise<Buffer> {
    this.pack.end();
    await this.finished;
    return Buffer.concat(this.chunks);
  }

  private add(
    path: string,
    data: Buffer,
    mode: number,
    type: "File" | "Directory",
  ): void {
    const header = new Header({
      path,
      mode,
      size: data.length,
      type,
      mtime: new Date(0),
      uid: 0,
      gid: 0,
    });
    const entry = new ReadEntry(header);
    entry.end(data);
    this.pack.add(entry);
  }
}

/** The companion integration, shipped next to `dist/` and `src/`. */
export function companionDirectory(): string {
  return fileURLToPath(new URL("../../companion/", import.meta.url));
}

function addCompanion(builder: TarBuilder): void {
  const root = join(
    companionDirectory(),
    "custom_components",
    COMPANION_DOMAIN,
  );
  const target = posix.join(CONFIG_ROOT, "custom_components", COMPANION_DOMAIN);
  builder.addDirectory(posix.join(CONFIG_ROOT, "custom_components"));
  builder.addDirectory(target);
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name === "__pycache__") continue;
      const full = join(directory, name);
      const inside = posix.join(prefix, name);
      if (statSync(full).isDirectory()) {
        builder.addDirectory(inside);
        walk(full, inside);
      } else {
        builder.addFile(inside, readFileSync(full));
      }
    }
  };
  walk(root, target);
}

/** The baseline configuration plus the companion: an instance with nothing of the user's. */
export async function packConfig(): Promise<Buffer> {
  const builder = new TarBuilder();
  builder.addDirectory(CONFIG_ROOT);
  builder.addFile(
    posix.join(CONFIG_ROOT, "configuration.yaml"),
    BASELINE_CONFIGURATION,
  );
  addCompanion(builder);
  return builder.finish();
}
