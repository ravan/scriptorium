#!/usr/bin/env bun
// Reads and updates the ingest manifest.
// Usage:
//   bun manifest.ts status [wiki-folder]
//   bun manifest.ts pending [wiki-folder]
//   bun manifest.ts mark-ingested <raw-file...> --pages "wiki/sources/a.md,wiki/topics/b.md"
import { loadManifest, saveManifest, wikiRootOrDie } from "./common";

const cmd = process.argv[2];
const rest = process.argv.slice(3);

function flag(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i > -1 ? rest[i + 1] : undefined;
}

if (cmd === "status" || cmd === "pending") {
  const root = wikiRootOrDie(rest[0]);
  const m = loadManifest(root);
  const entries = Object.entries(m.files).filter(([, e]) =>
    cmd === "pending" ? e.status === "extracted" || e.status === "error" || e.status === "unsupported" : true,
  );
  if (!entries.length) {
    console.log(cmd === "pending" ? "Nothing waiting. All sources are ingested." : "Manifest is empty.");
    process.exit(0);
  }
  for (const [rel, e] of entries) {
    console.log(`${e.status.padEnd(11)} ${e.type.padEnd(11)} ${rel}${e.note ? `  [${e.note}]` : ""}`);
  }
} else if (cmd === "mark-ingested") {
  const files = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--pages" && rest[i - 1] !== "--root");
  const pages = (flag("--pages") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const root = wikiRootOrDie(flag("--root"));
  const m = loadManifest(root);
  for (const rel of files) {
    const e = m.files[rel];
    if (!e) {
      console.error(`not in manifest: ${rel}`);
      process.exit(1);
    }
    if (e.status === "removed") {
      console.error(`refusing: ${rel} is removed from raw/. Keep its source page, but a removed file is never marked ingested.`);
      continue;
    }
    e.status = "ingested";
    e.ingestedAt = new Date().toISOString();
    e.pagesTouched = [...new Set([...(e.pagesTouched ?? []), ...pages])];
    console.log(`ingested: ${rel}  (pages: ${e.pagesTouched.join(", ") || "none recorded"})`);
  }
  saveManifest(root, m);
} else {
  console.error("Usage: bun manifest.ts status|pending [wiki-folder]\n       bun manifest.ts mark-ingested <raw-file...> --pages a.md,b.md [--root <wiki-folder>]");
  process.exit(1);
}
