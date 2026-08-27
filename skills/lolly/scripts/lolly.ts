#!/usr/bin/env bun
/**
 * lolly.ts - deterministic client for the hosted Lolly asset generator.
 *
 * This file is the I/O shell: network, cache, local Chrome, stdout, exit codes.
 * The rules it applies - URL encoding, input validation, chain assembly, canvas
 * fitting, output formatting - live in lolly-core.ts, which is pure and covered
 * by lolly.test.ts.
 *
 * No local Lolly install, no MCP, no auth. Two public hosts:
 *   - CATALOG host (default https://lolly.tools): serves the tool index,
 *     per-tool manifests and the asset index as plain JSON. Renders NOTHING
 *     over GET (that route is switched off there by policy - always 404).
 *   - RENDER host (default https://lolly.art): community tools only; serves
 *     real bytes at GET /tool/<id>.<ext>?<inputs> for browser-free formats
 *     (svg for every tool, png for SVG-native tools, plus
 *     emf/eps/eps-cmyk/dxf/html/md/txt/json/csv/ics/vcf).
 *
 * Commands:
 *   bun lolly.ts catalog [query]          the whole surface, grouped, one line per tool
 *   bun lolly.ts tools [query]            list tools (id, status, version, formats, description)
 *   bun lolly.ts describe <id>            one tool's inputs, defaults, formats, authored examples
 *   bun lolly.ts assets [query]           list catalog asset ids (logos, palettes, fonts)
 *   bun lolly.ts url <id> [k=v ...] [--format=svg]
 *                                         the editable app link, without rendering
 *   bun lolly.ts render <id> -o <file> [k=v ...] [--format=svg]
 *                                         render one tool to a file
 *   bun lolly.ts chain <id> [k=v ...] --then <id>:<asset-input> [k=v ...] -o <file>
 *                                         pipe one tool's render into the next,
 *                                         one execution; the script builds and
 *                                         encodes the nested URLs, and fits each
 *                                         step to the next tool's canvas
 *
 * Output contract: a render writes the FILE and a sidecar <file>.lolly.json
 * holding the editable share link plus the exact inputs. Callers get a path,
 * never a URL - nothing long or encoded has to be retyped or carried around.
 *
 * Flags: --catalog=<host> --render-host=<host> --format=<fmt> -o <file>
 *        --fresh  bypass the cache for this call
 * Env:   LOLLY_CATALOG_HOST, LOLLY_RENDER_HOST override the default hosts.
 *        LOLLY_CACHE_DIR overrides where catalog JSON is cached.
 *        LOLLY_CHROME points at a Chrome/Chromium binary (auto-detected
 *        otherwise, same candidates as the wiki's compose scripts).
 *
 * Two render tiers, both one call, no auth, no MCP:
 *   1. GET https://lolly.art/tool/<id>.<ext> - instant, for community tools in
 *      browser-free formats (svg-native svg/png, vector + data formats).
 *   2. Local headless Chrome drives the public lolly.tools web shell to
 *      `#/tool/<id>?...&format=<fmt>&export` and captures the file the app's
 *      own export path downloads. Works for EVERY catalog tool and EVERY
 *      declared format - script-drawn SVG (d3), brand-pack tools (quotes,
 *      org-chart), pdf, raster, video - exactly the bytes a human's Download
 *      button would produce.
 *
 * Caching: every catalog fetch (tool index, tool.json manifests, asset index)
 * is cached for 24 hours, keyed by URL. Rendered bytes are never cached. If the
 * network fails and a cache entry exists (even stale), it is served with a
 * warning, so lookups keep working offline.
 *
 * Exit codes: 0 ok · 1 render failed/refused by server · 2 usage (unknown
 * tool/input/format) · 3 not renderable here (the tool or format needs the app
 * and no Chrome was found).
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GET_FORMATS, UsageError,
  annotateSvg, cacheKey, exportTimeoutMs, findAnchors, formatCatalog, formatDescribe,
  formatProbe, formatToolList, parseArgs, pickFormat, planChain, planFinish, query, shareLink,
  splitChainSegments, validateInputs,
  type ChainStepSpec, type Inputs, type Manifest, type Tool,
} from "./lolly-core.ts";

const CATALOG = (process.env.LOLLY_CATALOG_HOST ?? "https://lolly.tools").replace(/\/$/, "");
const RENDER = (process.env.LOLLY_RENDER_HOST ?? "https://lolly.art").replace(/\/$/, "");

// 24h URL-keyed cache for catalog JSON (never for rendered bytes).
const CACHE_DIR = process.env.LOLLY_CACHE_DIR ?? join(import.meta.dir, "..", ".cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FRESH = process.argv.includes("--fresh");

async function getJson<T>(url: string): Promise<T> {
  const file = join(CACHE_DIR, cacheKey(url));
  const cached = existsSync(file);
  if (!FRESH && cached && Date.now() - statSync(file).mtimeMs < CACHE_TTL_MS) {
    return (await Bun.file(file).json()) as T;
  }
  let res: Response;
  try {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  } catch (e) {
    if (cached) {
      console.error(`warning: fetch failed (${(e as Error).message}); serving stale cache for ${url}`);
      return (await Bun.file(file).json()) as T;
    }
    throw e;
  }
  const data = (await res.json()) as T;
  await Bun.write(file, JSON.stringify(data)); // creates the cache dir as needed
  return data;
}

const toolIndex = (host: string) => getJson<{ tools: Tool[] }>(`${host}/catalog/tools/index.json`);
const manifest = (host: string, id: string) => getJson<Manifest>(`${host}/tools/${id}/tool.json`);

/** Read a manifest, turning a missing tool into a usage error rather than a crash. */
async function readManifest(host: string, id: string): Promise<Manifest> {
  try {
    return await manifest(host, id);
  } catch (e) {
    throw new UsageError(`Cannot read ${id}: ${(e as Error).message}`);
  }
}

function fail(code: number, msg: string): never {
  console.error(msg);
  process.exit(code);
}

// ── Browser tier: local headless Chrome drives the public web shell ─────────
// Mirrors what the wiki compose scripts do for PDF: find an existing
// Chrome/Chromium. LOLLY_CHROME (or WIKI_CHROME) overrides.
function findChrome(): string | null {
  // An explicit opt-out, for CI, sandboxes and tests: never launch a browser,
  // take the "needs a human" path instead. Without this the search always finds
  // a real Chrome on a developer machine, whatever LOLLY_CHROME points at.
  if (process.env.LOLLY_NO_BROWSER) return null;
  const cands = [
    process.env.LOLLY_CHROME,
    process.env.WIKI_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];
  for (const c of cands) if (existsSync(c)) return c;
  const pw = join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((x) => x.startsWith("chromium")).sort().reverse()) {
      for (const rel of ["chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/headless_shell", "chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = join(pw, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

/** Minimal CDP client over Chrome's browser-level websocket. */
class Cdp {
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, (v: unknown) => void>();
  onEvent: (method: string, params: Record<string, unknown>) => void = () => {};
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m.result ?? m.error); this.pending.delete(m.id); }
      else if (m.method) this.onEvent(m.method, m.params ?? {});
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error(`cannot connect to Chrome at ${url}`)));
    });
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  close(): void { try { this.ws.close(); } catch { /* closing */ } }
}

/**
 * Render via the app itself: open `#/tool/<id>?...&format=<fmt>&export` in a
 * local headless Chrome and capture the file the export path downloads - the
 * same bytes a human's Download button produces. Generic over all tools and
 * formats. Returns false when no Chrome exists, so the caller can fall back.
 */
async function browserRender(
  catalogHost: string,
  id: string,
  inputs: Inputs,
  format: string,
  out: string,
  timeoutMs: number,
): Promise<boolean> {
  const chrome = findChrome();
  if (!chrome) return false;
  const workDir = join(tmpdir(), `lolly-render-${process.pid}-${Date.now()}`);
  const dlDir = join(workDir, "dl");
  mkdirSync(dlDir, { recursive: true });
  // The app's export defaults Content Credentials ON (fresh signature per run).
  // A scripted asset wants determinism, so default c2pa=off; k=v c2pa=30 re-opts.
  const extra: Record<string, string> = { format, export: "1" };
  if (!inputs.some(([k]) => k === "c2pa")) extra.c2pa = "off";
  const url = `${catalogHost}/#/tool/${id}?${query(inputs, extra)}`;

  const proc = Bun.spawn([
    chrome, "--headless=new", "--remote-debugging-port=0",
    `--user-data-dir=${join(workDir, "profile")}`,
    "--no-first-run", "--no-default-browser-check", "--no-sandbox",
    "--force-color-profile=srgb", "--font-render-hinting=none",
    "about:blank",
  ], { stderr: "pipe", stdout: "ignore" });
  try {
    // Chrome prints "DevTools listening on ws://..." on stderr once ready.
    let wsUrl = "";
    const reader = proc.stderr.getReader();
    const deadline = Date.now() + 20_000;
    let buf = "";
    while (!wsUrl && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) wsUrl = m[1]!;
    }
    reader.releaseLock();
    if (!wsUrl) fail(1, "Chrome started but never announced its DevTools socket.");

    const cdp = await Cdp.connect(wsUrl);
    try {
      const downloaded = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(
          `no "${format}" export arrived within ${timeoutMs / 1000}s - ` +
          `the tool may need inputs, or the format may not be exportable in the app`)), timeoutMs);
        cdp.onEvent = (method, params) => {
          if (method === "Browser.downloadProgress" && params.state === "completed") {
            clearTimeout(timer);
            resolve(String(params.guid));
          }
        };
      });
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dlDir, eventsEnabled: true });
      await cdp.send("Target.createTarget", { url });
      const guid = await downloaded;
      const bytes = new Uint8Array(await Bun.file(join(dlDir, guid)).arrayBuffer());
      if (!bytes.length) fail(1, "The app's export produced an empty file.");
      await Bun.write(out, bytes);
      return true;
    } finally {
      cdp.close();
    }
  } catch (e) {
    fail(1, `Browser render failed: ${(e as Error).message}`);
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
    rmSync(workDir, { recursive: true, force: true });
  }
}

const cmd = process.argv[2];

async function main(): Promise<void> {
  const { flags, inputs, positional } = parseArgs(process.argv.slice(3));
  const catalogHost = flags.catalog ?? CATALOG;
  const renderHost = flags["render-host"] ?? RENDER;

  /**
   * Render one tool to a file, over whichever tier can serve it, and drop a
   * sidecar `<out>.lolly.json` holding the editable share link and the exact
   * inputs. The FILE PATH is the handoff: a caller gets a path, not a URL, so
   * no long encoded link ever has to travel through a prompt or be retyped.
   */
  async function renderTo(id: string, toolInputs: Inputs, format: string, out: string): Promise<void> {
    const share = shareLink(catalogHost, id, toolInputs, format);
    const sidecar = `${out}.lolly.json`;
    const note = async (via: string, bytes: number) => {
      await Bun.write(sidecar, JSON.stringify({
        tool: id, format, output: out, bytes, via,
        inputs: Object.fromEntries(toolInputs),
        editableLink: share,
      }, null, 2));
      console.log(`wrote ${out} (${bytes} bytes, ${format}, ${via})`);
      console.log(`editable link saved to ${sidecar}`);
    };

    // The GET host can't serve this ask → render it in a local headless Chrome
    // driving the public web shell. Only with no Chrome does a human get involved.
    const viaApp = async (why: string): Promise<never> => {
      if (await browserRender(catalogHost, id, toolInputs, format, out, exportTimeoutMs(format))) {
        await note("local Chrome + web shell", Bun.file(out).size);
        process.exit(0);
      }
      fail(3, `${why}\nNo Chrome/Chromium found on this machine, so this needs a human. Run ` +
        `\`bun lolly.ts url ${id} ...\` for the link to hand over, or install Chrome / set ` +
        `LOLLY_CHROME to render this in one call.`);
    };

    if (!GET_FORMATS.has(format)) {
      await viaApp(`"${format}" cannot be fetched over GET (browser-tier format).`);
    }
    const { tools } = await toolIndex(renderHost);
    if (!tools.some((t) => t.id === id)) {
      await viaApp(`${id} is not on the public render host (brand-pack tool).`);
    }
    const raw = `${renderHost}/tool/${id}.${format}?${query(toolInputs)}`;
    const res = await fetch(raw, { redirect: "follow" });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      // HTML-layout tools can't emit even svg over GET - the server says so.
      if (/browser|<svg>|drawable/i.test(body)) {
        await viaApp(`${id} needs the browser tier for "${format}" (HTML-layout tool). Server said: ${body}`);
      }
      fail(1, `Render failed for ${id} (${format}): ${res.status}\n${body}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) fail(1, `Render returned 0 bytes for ${id} (${format}).`);
    await Bun.write(out, bytes);
    await note("lolly.art GET", bytes.length);
  }

  // `--image` narrows a listing to tools that can produce a picture - the same
  // set the app's own "Choose Visual" picker offers. `--format=` narrows to one
  // declared output format.
  const listFilter = {
    q: (positional[0] ?? "").toLowerCase(),
    image: Boolean(flags.image),
    format: flags.format,
  };

  if (cmd === "catalog") {
    const { tools } = await toolIndex(catalogHost);
    for (const line of formatCatalog(tools, listFilter, catalogHost)) console.log(line);
  } else if (cmd === "tools") {
    const { tools } = await toolIndex(catalogHost);
    for (const line of formatToolList(tools, listFilter, catalogHost)) console.log(line);
  } else if (cmd === "describe") {
    const id = positional[0];
    if (!id) throw new UsageError("Usage: describe <tool-id>");
    for (const line of formatDescribe(await readManifest(catalogHost, id))) console.log(line);
  } else if (cmd === "assets") {
    const q = (positional[0] ?? "").toLowerCase();
    const idx = await getJson<{ assets: Array<{ id: string; type: string; name?: string }> }>(
      `${catalogHost}/catalog/assets/index.json`,
    );
    const hits = idx.assets.filter((a) => !q || `${a.id} ${a.name ?? ""}`.toLowerCase().includes(q));
    for (const a of hits) console.log(`${a.id}  [${a.type}]  ${a.name ?? ""}`);
    if (!hits.length) console.log(`No asset matches "${q}" on ${catalogHost}`);
  } else if (cmd === "url" || cmd === "render") {
    const id = positional[0];
    if (!id) throw new UsageError(`Usage: ${cmd} <tool-id> [k=v ...]`);
    const m = await readManifest(catalogHost, id);
    validateInputs(m, inputs);
    const format = pickFormat(m, flags.format);

    if (cmd === "url") {
      console.log(`editable link: ${shareLink(catalogHost, id, inputs, flags.format)}`);
      if (!GET_FORMATS.has(format)) {
        console.log(`note: "${format}" is browser-tier - render fetches it via local headless Chrome.`);
      }
      console.log("To feed this tool's output into another tool, use `chain` - never paste a URL by hand.");
      return;
    }
    if (!flags.output) throw new UsageError("render needs -o <file>");
    await renderTo(id, inputs, format, flags.output);
  } else if (cmd === "probe") {
    // Read a render's coordinate space and its anchorable shapes, so a caller
    // can place annotations from measured positions instead of guessing.
    const file = positional[0];
    if (!file) throw new UsageError("Usage: probe <file.svg>");
    if (!existsSync(file)) throw new UsageError(`No such file: ${file}`);
    const svg = await Bun.file(file).text();
    const anchors = findAnchors(svg, { minSize: Number(flags["min-size"] ?? 12) });
    for (const line of formatProbe(svg, anchors)) console.log(line);
  } else if (cmd === "annotate") {
    // Lay one group over a render without touching the base.
    const [file, layerArg] = positional;
    if (!file) throw new UsageError("Usage: annotate <base.svg> --layer <file|-> -o <out.svg> [--pad-right=N ...]");
    if (!existsSync(file)) throw new UsageError(`No such file: ${file}`);
    const out = flags.output;
    if (!out) throw new UsageError("annotate needs -o <file>");
    const layerSrc = flags.layer ?? layerArg;
    if (!layerSrc) throw new UsageError("annotate needs --layer <file> (or --layer=- to read stdin)");
    const layer = layerSrc === "-"
      ? await Bun.stdin.text()
      : existsSync(layerSrc) ? await Bun.file(layerSrc).text() : layerSrc;
    const num = (k: string) => (flags[k] === undefined ? undefined : Number(flags[k]));
    const svg = annotateSvg(await Bun.file(file).text(), layer, {
      pad: { top: num("pad-top"), right: num("pad-right"), bottom: num("pad-bottom"), left: num("pad-left") },
      id: flags["layer-id"],
    });
    await Bun.write(out, svg);
    console.log(`wrote ${out} (${svg.length} bytes) - base untouched, additions in one group`);
  } else if (cmd === "chain") {
    // One pipeline, one render. planChain builds and encodes every nested embed
    // URL, so a caller never writes one and cannot mis-encode it.
    const parsed = splitChainSegments(process.argv.slice(3)).map(parseArgs);
    const allFlags = Object.assign({}, ...parsed.map((p) => p.flags)) as Record<string, string>;
    const out = allFlags.output;
    if (!out) throw new UsageError("chain needs -o <file>");

    // Load every manifest first: a step needs the NEXT tool's canvas to fit itself.
    const specs: ChainStepSpec[] = await Promise.all(parsed.map(async (p, i) => {
      const spec = p.positional[0];
      if (!spec) throw new UsageError(`Step ${i + 1} has no tool id.`);
      const [id, slot] = spec.split(":");
      return { id: id!, slot, inputs: p.inputs, m: await readManifest(catalogHost, id!) };
    }));

    const plan = planChain(specs, { catalogHost, requestedFormat: allFlags.format });
    for (const w of plan.warnings) console.error(`warning: ${w}`);
    for (const line of plan.progress) console.error(line);
    const last = plan.steps[plan.steps.length - 1]!;
    await renderTo(last.id, last.inputs, last.finalFormat!, out);
  } else if (cmd === "finish") {
    // Repair an animated export: put a ground behind it, and give it a codec
    // that plays. See planFinish for why both are needed.
    const [file] = positional;
    if (!file) {
      throw new UsageError("Usage: finish <in.gif> [--ground <hex> -o <out.gif>] [--mp4 <out.mp4>] [--width N]");
    }
    if (!existsSync(file)) throw new UsageError(`No such file: ${file}`);
    const plan = planFinish({
      input: file,
      ground: flags.ground,
      out: flags.output,
      mp4: flags.mp4,
      width: flags.width === undefined ? undefined : Number(flags.width),
    });
    for (const tool of plan.needs) {
      if (!Bun.which(tool)) {
        throw new UsageError(`finish needs ${tool}. Install it: brew install ${tool === "magick" ? "imagemagick" : "ffmpeg"}`);
      }
    }
    for (const argv of [plan.magick, plan.ffmpeg]) {
      if (!argv) continue;
      const proc = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
      if (proc.exitCode !== 0) {
        console.error(proc.stderr.toString());
        throw new Error(`finish: ${argv[0]} failed`);
      }
      console.log(`ran ${argv[0]} -> ${argv[argv.length - 1]}`);
    }
    // The sidecar is how the visual gets regenerated later, so carry it across
    // to every file this command produced.
    const sidecar = `${file}.lolly.json`;
    if (existsSync(sidecar)) {
      for (const made of [plan.magick?.at(-1), plan.ffmpeg?.at(-1)].filter(Boolean) as string[]) {
        if (made !== file) await Bun.write(`${made}.lolly.json`, Bun.file(sidecar));
      }
      console.log("copied the editable link sidecar onto the new file(s)");
    }
  } else {
    throw new UsageError("Usage: lolly.ts catalog|tools|describe|assets|url|render|chain|probe|annotate|finish ... (see header comment)");
  }
}

try {
  await main();
} catch (e) {
  if (e instanceof UsageError) fail(e.code, e.message);
  throw e;
}
