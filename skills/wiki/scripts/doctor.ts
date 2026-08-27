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

const results = checks.map((c) => ({ ...c, found: have(c.cmd) }));
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
