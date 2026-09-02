#!/usr/bin/env bun
// Checks the wiki's own wiring: broken relative links, wikilink syntax, orphan pages,
// pages the manifest claims exist but do not, pages missing their purpose line,
// link targets with unencoded spaces, and source pages not at the schema name.
// Also regenerates the machine-readable catalog and graph:
//
//   wiki/index.json - every page: path, category, title (H1), summary (the page's
//                     purpose line), link count. Fully derived from the pages, so
//                     "index drift" cannot exist.
//   wiki/map.json   - the graph: nodes, directed edges, clusters (label
//                     propagation), hubs, orphans.
//
// Agents query these through `bun wiki.ts <cmd>` instead of reading them whole;
// humans ask for `bun wiki.ts render` when they want a readable version.
//
// Usage:
//   bun links.ts            # report + rewrite index.json/map.json
//   bun links.ts --quiet    # same, but print nothing when everything is clean
//
// Exit code 1 when anything is broken, so it can gate a commit.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { loadManifest, markdownLinks, sourcePageSlug, wikiRootOrDie } from "./common";

const root = wikiRootOrDie();
const quiet = process.argv.includes("--quiet");
const wikiDir = join(root, "wiki");

if (!existsSync(wikiDir)) {
  console.error("No wiki/ folder here.");
  process.exit(1);
}

// Legacy hand-maintained meta files from before the JSON formats. They are not
// content; lint offers to convert/delete them (see references/lint.md).
const LEGACY_META = new Set(["index.md", "map.md", "log.md"]);
const isLegacyMeta = (p: string) => dirname(p) === wikiDir && LEGACY_META.has(basename(p));

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith(".md")) out.push(p);
  }
  return out;
}

const pages = walk(wikiDir)
  .filter((p) => !isLegacyMeta(p))
  .sort();

interface Broken {
  page: string;
  target: string;
  line: number;
  why: string;
}

const broken: Broken[] = [];
const wikilinks: Broken[] = [];
const spaced: Broken[] = []; // targets with an unencoded space: not a link in strict markdown
const linkedTo = new Set<string>(); // absolute paths of wiki pages that something links to
const edges: Array<[string, string]> = []; // directed page -> page links

const WIKILINK = /\[\[([^\]]+)\]\]/g;

for (const page of pages) {
  const text = readFileSync(page, "utf8");
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    for (const m of line.matchAll(WIKILINK)) {
      wikilinks.push({ page, target: m[1]!, line: i + 1, why: "wikilink syntax; use a relative markdown link" });
    }

    for (const link of markdownLinks(line)) {
      if (link.external || !link.target) continue;
      const abs = resolve(dirname(page), link.target);
      if (!existsSync(abs)) {
        broken.push({ page, target: link.raw, line: i + 1, why: "target does not exist" });
        continue;
      }
      // Raw file names carry spaces all the time. The old matcher stopped at
      // the space and never saw the link, so it could not report it.
      if (link.hasSpace) spaced.push({ page, target: link.raw, line: i + 1, why: "space in link target" });
      if (abs.startsWith(wikiDir) && abs.endsWith(".md") && !isLegacyMeta(abs)) {
        linkedTo.add(abs);
        edges.push([page, abs]);
      }
    }
  }
}

// Orphans: content pages no other page links to.
const orphans = pages.filter((p) => !linkedTo.has(p));

// Manifest pagesTouched pointing at pages that are gone (legacy meta paths excused).
const m = loadManifest(root);
const missingTouched: Array<{ source: string; page: string }> = [];
for (const [rel, e] of Object.entries(m.files)) {
  for (const p of e.pagesTouched ?? []) {
    if (/^wiki\/(index|map|log)\.md$/.test(p)) continue;
    if (!existsSync(join(root, p))) missingTouched.push({ source: rel, page: p });
  }
}

// Sources marked ingested that have no source page at all.
const noSourcePage: string[] = [];
// Sources whose page exists but not under the schema's name (folders joined
// with "--", extension dropped). A warning: the page works, the convention drifted.
const misnamedSource: Array<{ source: string; expected: string; actual: string }> = [];
for (const [rel, e] of Object.entries(m.files)) {
  if (e.status !== "ingested") continue;
  const sourcePages = (e.pagesTouched ?? []).filter((p) => p.startsWith("wiki/sources/") && existsSync(join(root, p)));
  if (!sourcePages.length) {
    noSourcePage.push(rel);
    continue;
  }
  const expected = `wiki/sources/${sourcePageSlug(rel)}.md`;
  if (!existsSync(join(root, expected)) && !sourcePages.includes(expected))
    misnamedSource.push({ source: rel, expected, actual: sourcePages[0]! });
}

// ---- index.json + map.json ---------------------------------------------------

function firstLines(p: string): { title: string; summary: string } {
  let title = basename(p, ".md");
  let summary = "";
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      if (summary === "" && title === basename(p, ".md")) title = t.replace(/^#+\s*/, "");
      continue;
    }
    summary = t.length > 200 ? `${t.slice(0, 197)}...` : t;
    break;
  }
  return { title, summary };
}
const meta = new Map(pages.map((n) => [n, firstLines(n)]));
const noPurpose = pages.filter((p) => !meta.get(p)!.summary);

// Undirected adjacency for degree + clustering; edges stay directed in map.json.
const nodeIndex = new Map(pages.map((n, i) => [n, i]));
const adj = new Map<string, Set<string>>(pages.map((n) => [n, new Set<string>()]));
const directed: Array<[number, number]> = [];
{
  const seenPair = new Set<string>();
  for (const [a, b] of edges) {
    if (a === b) continue;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
    const key = `${nodeIndex.get(a)}>${nodeIndex.get(b)}`;
    if (!seenPair.has(key)) {
      seenPair.add(key);
      directed.push([nodeIndex.get(a)!, nodeIndex.get(b)!]);
    }
  }
  directed.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}
const degree = (p: string) => adj.get(p)!.size;

// Label propagation: each page adopts the most common label among its
// neighbours (deterministic order, capped rounds). Simple, and good enough to
// name the neighbourhoods of a personal wiki.
const label = new Map<string, string>(pages.map((n) => [n, n]));
for (let round = 0; round < 20; round++) {
  let changed = false;
  for (const n of pages) {
    const counts = new Map<string, number>();
    for (const nb of adj.get(n)!) {
      const l = label.get(nb)!;
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    if (!counts.size) continue;
    let best = label.get(n)!;
    let bestC = counts.get(best) ?? 0;
    for (const [l, c] of [...counts.entries()].sort()) {
      if (c > bestC) {
        best = l;
        bestC = c;
      }
    }
    if (best !== label.get(n)) {
      label.set(n, best);
      changed = true;
    }
  }
  if (!changed) break;
}
const clusterMap = new Map<string, string[]>();
for (const n of pages) {
  const l = label.get(n)!;
  const g = clusterMap.get(l) ?? [];
  g.push(n);
  clusterMap.set(l, g);
}
const byDegree = (a: string, b: string) => degree(b) - degree(a) || a.localeCompare(b);
const clusterList = [...clusterMap.values()]
  .map((members) => members.sort(byDegree))
  .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));

const relRoot = (p: string) => relative(root, p);
const category = (p: string) => {
  const r = relative(wikiDir, p);
  return r.includes("/") ? r.split("/")[0]! : "(top level)";
};

const indexJson = {
  note: "Generated by scripts/links.ts from the pages themselves. Do not edit. Query with: bun scripts/wiki.ts",
  generatedAt: new Date().toISOString(),
  pages: pages.map((p) => ({
    path: relRoot(p),
    category: category(p),
    title: meta.get(p)!.title,
    summary: meta.get(p)!.summary,
    links: degree(p),
  })),
};
writeFileSync(join(wikiDir, "index.json"), JSON.stringify(indexJson, null, 2) + "\n");

const mapJson = {
  note: "Generated by scripts/links.ts. Do not edit. Query with: bun scripts/wiki.ts",
  generatedAt: new Date().toISOString(),
  nodes: pages.map((p) => ({ path: relRoot(p), title: meta.get(p)!.title, degree: degree(p) })),
  edges: directed, // [from, to] as indexes into nodes
  clusters: clusterList.map((members) => ({
    name: meta.get(members[0]!)!.title,
    members: members.map((p) => nodeIndex.get(p)!),
  })),
  hubs: [...pages].sort(byDegree).slice(0, 10).map((p) => nodeIndex.get(p)!),
  orphans: orphans.map((p) => nodeIndex.get(p)!),
};
writeFileSync(join(wikiDir, "map.json"), JSON.stringify(mapJson, null, 2) + "\n");

// ---- report -------------------------------------------------------------------

const problems = broken.length + wikilinks.length + spaced.length + missingTouched.length + noSourcePage.length;
const warnings = orphans.length + noPurpose.length + misnamedSource.length;

if (quiet && problems === 0 && warnings === 0) process.exit(0);

console.log(
  `Checked ${pages.length} wiki page(s). Regenerated wiki/index.json and wiki/map.json (${directed.length} links, ${clusterList.length} cluster(s)).`,
);

function show(title: string, rows: string[]) {
  if (!rows.length) return;
  console.log(`\n${title} (${rows.length}):`);
  for (const r of rows) console.log(`  ${r}`);
}

show(
  "Broken links",
  broken.map((b) => `${relRoot(b.page)}:${b.line}  ->  ${b.target}`),
);
show(
  "Wikilinks (this wiki uses relative markdown links)",
  wikilinks.map((b) => `${relRoot(b.page)}:${b.line}  ->  [[${b.target}]]`),
);
show(
  "Space in link target (strict markdown drops the link; write %20 for each space, or wrap the target in <...>)",
  spaced.map((b) => `${relRoot(b.page)}:${b.line}  ->  ${b.target}`),
);
show(
  "Manifest points at pages that do not exist",
  missingTouched.map((x) => `${x.source}  ->  ${x.page}`),
);
show("Marked ingested but has no source page", noSourcePage);
show(
  "Source page not at the schema's name (folders joined with --, extension dropped); rename or leave, but know which",
  misnamedSource.map((x) => `${x.source}  ->  have ${x.actual}, expected ${x.expected}`),
);
show(
  "Orphan pages (no other page links to them)",
  orphans.map((p) => relRoot(p)),
);
show(
  "Missing purpose line (first non-heading line is the page's index summary)",
  noPurpose.map((p) => relRoot(p)),
);

const legacy = [...LEGACY_META].filter((f) => existsSync(join(wikiDir, f)));
if (legacy.length)
  console.log(
    `\nLegacy hand-maintained meta files present: ${legacy.map((f) => `wiki/${f}`).join(", ")}. ` +
      `index/map are replaced by the generated JSON; convert log.md to log.jsonl (see references/lint.md), then delete them.`,
  );

if (problems === 0 && orphans.length === 0) {
  console.log("\nEverything resolves. No orphans.");
} else if (problems === 0) {
  console.log("\nAll links resolve. Orphans are a judgement call, not an error.");
}

process.exit(problems ? 1 : 0);
