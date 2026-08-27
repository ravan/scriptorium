#!/usr/bin/env bun
// Back-compat shim: the document renderer now lives in compose-doc.ts and also
// produces .md and .pdf. This keeps the old CLI working.
// Usage: bun compose-docx.ts <spec.json> [-o out.docx]
import { join } from "node:path";

const args = process.argv.slice(2);
if (!args[0]) {
  console.error("Usage: bun compose-docx.ts <spec.json> [-o out.docx]");
  process.exit(1);
}
if (!args.includes("-o")) args.push("-o", args[0].replace(/\.json$/, "") + ".docx");
const r = Bun.spawnSync(["bun", join(import.meta.dir, "compose-doc.ts"), ...args], { stdout: "inherit", stderr: "inherit" });
process.exit(r.exitCode ?? 1);
