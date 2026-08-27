#!/usr/bin/env bun
// Checks the tools the wiki needs. Prints plain-language status.
// Usage: bun doctor.ts [--json]
import { have } from "./common";

interface Check {
  cmd: string;
  why: string;
  install: string;
  required: boolean;
}

const checks: Check[] = [
  {
    cmd: "unzip",
    why: "opens PowerPoint (.pptx) and Word (.docx) files",
    install: "comes with macOS; on Linux: sudo apt install unzip",
    required: true,
  },
  {
    cmd: "pdftotext",
    why: "reads the text out of PDF files",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "pdfimages",
    why: "pulls the images out of PDF files",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "pdftoppm",
    why: "makes a picture of each PDF page",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "pdfinfo",
    why: "counts PDF pages",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "git",
    why: "keeps version history of the wiki",
    install: "macOS: xcode-select --install",
    required: false,
  },
];

// Chrome/Chromium: only needed to render PDFs (compose-doc.ts); .md/.docx work without it.
function haveChrome(): boolean {
  const { existsSync } = require("node:fs");
  const cands = [
    process.env.WIKI_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];
  return cands.some(existsSync) || have("chromium") || have("google-chrome");
}

// Bun itself: 1.4+ is the floor (the scripts use Bun.Image for junk detection).
const bunOk = typeof Bun.Image === "function";
const results = [
  {
    cmd: "chrome",
    why: "turns documents into PDF files (only needed for .pdf output)",
    install: "install Google Chrome, or set WIKI_CHROME to a Chromium binary",
    required: false,
    found: haveChrome(),
  },
  {
    cmd: `bun ${Bun.version}`,
    why: "runs these scripts; 1.4 or newer is needed",
    install: "bun upgrade",
    required: true,
    found: bunOk,
  },
  ...checks.map((c) => ({ ...c, found: have(c.cmd) })),
];
const missing = results.filter((r) => !r.found);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: missing.filter((m) => m.required).length === 0, results }, null, 2));
  process.exit(0);
}

for (const r of results) {
  const mark = r.found ? "OK " : "MISSING";
  console.log(`${mark}  ${r.cmd}  (${r.why})${r.found ? "" : `\n         install with: ${r.install}`}`);
}

if (missing.length === 0) {
  console.log("\nAll tools are ready.");
} else {
  console.log(`\n${missing.length} tool(s) missing. Install commands are listed above.`);
  if (missing.some((m) => m.required)) process.exit(2);
}
