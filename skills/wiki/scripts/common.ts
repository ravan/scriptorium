// Shared helpers for the wiki scripts. Run with bun.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

export const MANIFEST_REL = join("raw", ".ingest-manifest.json");

export interface ManifestEntry {
  sha256: string;
  size: number;
  mtime: string;
  type: string; // pptx | docx | pdf | markdown | text | image | unsupported
  status: string; // extracted | ingested | removed | unsupported
  extractedAt?: string;
  ingestedAt?: string;
  derived?: string | null; // relative dir with extracted text/media, or null
  pagesTouched?: string[]; // wiki pages this source contributed to
  note?: string;
}

export interface Manifest {
  version: number;
  updatedAt: string;
  files: Record<string, ManifestEntry>;
}

// Walk up from a start dir until we find raw/.ingest-manifest.json.
export function findWikiRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, MANIFEST_REL))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function wikiRootOrDie(argPath?: string): string {
  const root = argPath ? findWikiRoot(argPath) : findWikiRoot(process.cwd());
  if (!root) {
    console.error(
      "Could not find a wiki here. A wiki has a raw/.ingest-manifest.json file.\n" +
        "Pass the wiki folder as an argument, or run setup.ts first.",
    );
    process.exit(1);
  }
  return root;
}

export function loadManifest(root: string): Manifest {
  const p = join(root, MANIFEST_REL);
  return JSON.parse(readFileSync(p, "utf8")) as Manifest;
}

export function saveManifest(root: string, m: Manifest): void {
  m.updatedAt = new Date().toISOString();
  writeFileSync(join(root, MANIFEST_REL), JSON.stringify(m, null, 2) + "\n");
}

export async function sha256(path: string): Promise<string> {
  const data = await Bun.file(path).arrayBuffer();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

// "sub/dir/deck.pptx" -> "sub__dir__deck.pptx" (safe folder name, keeps ext)
export function slugFor(relPath: string): string {
  return relPath.replaceAll("/", "__");
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function run(cmd: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    ok: p.exitCode === 0,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
  };
}

export function have(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}
