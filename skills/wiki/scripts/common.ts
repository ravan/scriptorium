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

// The wiki page for a raw source: "papers/whitepaper.docx" -> "papers--whitepaper".
// Folders join with "--" and the extension drops, so two same-named files in
// different folders never collide. links.ts checks pages against this.
export function sourcePageSlug(relPath: string): string {
  return relPath.replace(/\.[^./]+$/, "").replaceAll("/", "--");
}

export interface MarkdownLink {
  raw: string; // the target exactly as written, angle brackets stripped
  target: string; // decoded path with any #fragment removed
  hasSpace: boolean; // an unencoded space: strict markdown will not treat this as a link
  external: boolean; // http(s), mailto or a pure fragment
}

// Inline links and images on one line: [text](target "title") / ![alt](<target with spaces>).
// Spaces inside the target are matched on purpose. Strict markdown does not
// accept them, but people write them, and a regex that stopped at the first
// space would skip such a link in silence instead of reporting it.
const MD_LINK = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)]*?)(?:\s+"[^"]*")?\s*\)/g;

export function markdownLinks(line: string): MarkdownLink[] {
  const out: MarkdownLink[] = [];
  for (const m of line.matchAll(MD_LINK)) {
    let raw = m[1]!.trim();
    const bracketed = raw.startsWith("<") && raw.endsWith(">");
    if (bracketed) raw = raw.slice(1, -1);
    if (!raw) continue;
    const external = /^(https?:|mailto:|#)/.test(raw);
    let target = raw.split("#")[0]!;
    try {
      target = decodeURI(target);
    } catch {
      /* a stray % is still a path; check it as written */
    }
    out.push({ raw, target, hasSpace: !bracketed && /\s/.test(raw), external });
  }
  return out;
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
