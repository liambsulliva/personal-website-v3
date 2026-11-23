// Rendered images on disk: <dir>/<ab>/<sha1>.<ext>. Everything here can be
// rendered again, so losing it costs time and nothing else.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DAY = 86_400_000;

export class DiskCache {
  constructor(dir, { maxBytes = 5e9 } = {}) {
    this.dir = dir;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.sweeping = null;
    this.writes = 0;
  }

  name(key, ext) {
    const hash = createHash("sha1").update(key).digest("hex");
    return join(this.dir, hash.slice(0, 2), `${hash}.${ext}`);
  }

  async get(file) {
    try {
      const body = await readFile(file);
      const { mtimeMs } = await stat(file);
      // mtime is "last used" for the sweep, at a day's resolution.
      if (Date.now() - mtimeMs > DAY) utimes(file, new Date(), new Date()).catch(() => {});
      return body;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async put(file, body) {
    const temp = `${file}.${process.pid}.${this.writes++}.tmp`;
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(temp, body);
    await rename(temp, file);
    this.bytes += body.length;
    if (this.bytes > this.maxBytes) this.sweep().catch((error) => console.error("[cache] sweep failed", error));
  }

  /** Count what's there, and drop the least recently used down to 90% of the cap. */
  sweep() {
    this.sweeping ??= this.#sweep().finally(() => (this.sweeping = null));
    return this.sweeping;
  }

  async #sweep() {
    const files = [];
    for (const shard of await readdir(this.dir).catch(() => [])) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue;
      for (const name of await readdir(join(this.dir, shard))) {
        const file = join(this.dir, shard, name);
        const info = await stat(file).catch(() => null);
        if (!info) continue;
        // A crash between write and rename leaves a .tmp behind.
        if (name.endsWith(".tmp")) {
          if (Date.now() - info.mtimeMs > 3_600_000) await unlink(file).catch(() => {});
          continue;
        }
        files.push({ file, size: info.size, used: info.mtimeMs });
      }
    }
    let total = files.reduce((sum, { size }) => sum + size, 0);
    if (total > this.maxBytes) {
      for (const { file, size } of files.sort((a, b) => a.used - b.used)) {
        if (total <= this.maxBytes * 0.9) break;
        await unlink(file).catch(() => {});
        total -= size;
      }
    }
    this.bytes = total;
  }
}
