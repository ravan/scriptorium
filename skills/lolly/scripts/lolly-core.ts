/**
 * lolly-core.ts - the pure half of the Lolly client.
 *
 * Everything here is a value-in / value-out function: no fetch, no filesystem,
 * no process.exit, no Chrome. That is deliberate - it is the part with the
 * fiddly rules (URL encoding, input validation, chain assembly, canvas fitting)
 * and therefore the part worth testing directly. lolly.ts is the I/O shell that
 * wraps these with the network, the cache and the browser tier.
 *
 * Errors are thrown as UsageError, which carries the process exit code the CLI
 * should use. Nothing in this file writes to stdout.
 */

/** A caller mistake: unknown tool, unknown input, impossible format. Exit 2. */
export class UsageError extends Error {
  readonly code: number;
  constructor(message: string, code = 2) {
    super(message);
    this.name = "UsageError";
    this.code = code;
  }
}

export type Inputs = Array<[string, string]>;

export type Tool = {
  id: string; name: string; description: string; status: string;
  formats: string[]; width?: number; height?: number;
  version?: string; category?: string; tags?: string[]; exportable?: boolean;
};

/**
 * One field inside a `blocks` input. A blocks input is a LIST of records - a
 * deck's slides, a table's rows - and only these fields exist inside a record.
 * `showFor` names the record layouts the field applies to; a field set on a
 * layout that does not show it is silently dropped by the tool.
 */
export type ManifestBlockField = {
  id: string; type: string; label?: string; default?: unknown;
  showFor?: string[]; assetType?: string;
  options?: Array<{ value: string } | string>;
};

export type ManifestInput = {
  id: string; type: string; label?: string; default?: unknown;
  urlKey?: string; options?: Array<{ value: string } | string>; section?: string;
  bindToProfile?: string;
  /** Present on `blocks` inputs: the fields one record may carry. */
  fields?: ManifestBlockField[];
};

export type Manifest = {
  id: string; name: string; description?: string; status?: string;
  render?: { formats?: string[]; width?: number; height?: number; export?: boolean };
  inputs?: ManifestInput[];
  /** Input sets authored by the tool's designer - known-good, worth copying. */
  examples?: Array<{ label?: string; values?: Record<string, unknown> }>;
  composes?: unknown;
};

/**
 * Formats the render host can serve over GET without a browser tier. `png` is
 * included but only works for SVG-native tools - the server answers 400 with a
 * reason for the rest, which the CLI surfaces verbatim.
 */
export const GET_FORMATS = new Set([
  "svg", "emf", "eps", "eps-cmyk", "dxf", "html", "md", "txt", "json", "csv", "ics", "vcf", "png",
]);

/**
 * Formats that are a picture: something you can place on a slide, in a
 * document or on a page. A tool declaring any of these can be offered as a
 * visual, which is the set the app's own "Choose Visual" picker draws from.
 * Deliberately excludes pure data and text output (html, json, csv, ics, vcf,
 * md, txt), fonts, audio, and bare video containers with no still frame.
 */
export const IMAGE_FORMATS = new Set([
  "svg", "svg-anim", "png", "jpg", "jpeg", "webp", "avif", "tiff", "cmyk-tiff",
  "pdf", "pdf-cmyk", "emf", "eps", "eps-cmyk", "dxf", "ico", "gif", "apng", "webp-anim",
]);

/** Can this tool produce a picture at all? */
export function isImageTool(t: Tool): boolean {
  return t.formats.some((f) => IMAGE_FORMATS.has(f));
}

/** Reserved URL params: they control output, so they are never tool inputs. */
export const RESERVED = new Set([
  "format", "export", "copy", "full", "options", "slot", "output", "filename", "_v",
  "width", "w", "height", "h", "unit", "dpi", "bleed", "marks", "cuts", "c2pa",
  "imprint", "durable", "hdr", "depth", "password", "profile", "nostage", "lang",
  "z", "zx", "meta", "designv", "template",
]);

/** Formats whose export the app records in real time, or renders slowly. */
export function exportTimeoutMs(fmt: string): number {
  if (["webm", "mp4", "gif", "apng", "webp-anim", "svg-anim"].includes(fmt)) return 180_000;
  if (["pdf", "pdf-cmyk", "cmyk-tiff", "tiff", "pptx"].includes(fmt)) return 90_000;
  return 60_000;
}

/** Filesystem-safe cache filename for a catalog URL. */
export function cacheKey(url: string): string {
  return `${url.replace(/[^a-zA-Z0-9]+/g, "_")}.json`;
}

/**
 * Long flags that stand alone, with no `=value`. Everything else without a
 * value is a typo (`--format` meaning `--format=svg`), so it is rejected
 * rather than silently read as empty.
 */
export const BOOLEAN_FLAGS = new Set(["image"]);

export type ParsedArgs = {
  flags: Record<string, string>;
  inputs: Inputs;
  positional: string[];
};

/**
 * Split a command's argv into flags (`--k=v`, `-o path`), tool inputs (`k=v`)
 * and positionals. `--fresh` is global and `--then` is the chain separator, so
 * both are consumed elsewhere and ignored here.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const inputs: Inputs = [];
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o") {
      const v = argv[++i];
      if (v === undefined) throw new UsageError("-o needs a file path");
      flags.output = v;
    } else if (a === "--fresh" || a === "--then") {
      // handled by the caller
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq === -1) {
        const name = a.slice(2);
        if (!BOOLEAN_FLAGS.has(name)) throw new UsageError(`Flag ${a} needs =value`);
        flags[name] = "1";
      } else {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      }
    } else if (a.includes("=")) {
      const eq = a.indexOf("=");
      inputs.push([a.slice(0, eq), a.slice(eq + 1)]);
    } else {
      positional.push(a);
    }
  }
  return { flags, inputs, positional };
}

/** Every key a manifest will accept: input ids plus their short urlKey aliases. */
function knownKeys(m: Manifest): Set<string> {
  const known = new Set<string>();
  for (const inp of m.inputs ?? []) {
    known.add(inp.id);
    if (inp.urlKey) known.add(inp.urlKey);
  }
  return known;
}

/**
 * Reject an input the tool does not declare. Unknown URL params fail SILENTLY
 * on the server - the tool renders its defaults - so catching them here is the
 * difference between an error and a wrong-looking asset.
 */
export function validateInputs(m: Manifest, inputs: Inputs): void {
  const known = knownKeys(m);
  for (const [k] of inputs) {
    if (RESERVED.has(k)) continue;
    // A `vector` input (imageFraming, colour-stop positions) has no single-param
    // form - each field rides a dotted param, `imageFraming.zoom=200`.
    if (k.includes(".") && known.has(k.slice(0, k.indexOf(".")))) continue;
    if (!known.has(k)) {
      throw new UsageError(
        `"${k}" is not an input of ${m.id}. Declared inputs: ${[...known].sort().join(", ")}`,
      );
    }
  }
}

/** Encode inputs (plus any output-control extras) as a query string. */
export function query(inputs: Inputs, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of inputs) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** The editable app link - what a human opens to tweak and re-export. */
export function shareLink(catalogHost: string, id: string, inputs: Inputs, format?: string): string {
  const q = query(inputs, format ? { format } : {});
  return `${catalogHost}/#/tool/${id}${q ? `?${q}` : ""}`;
}

/**
 * The portable embed URL Lolly's engine recognises. The shell matches this
 * exact shape and renders the named tool locally, substituting the result -
 * nothing is fetched from the host. That strict match is the security boundary,
 * which is why this is built here and never by hand.
 */
export function embedUrl(catalogHost: string, id: string, format: string, inputs: Inputs): string {
  return `${catalogHost}/tool/${id}.${format}?${query(inputs)}`;
}

/**
 * Pick the output format: the caller's if they named one, else the tool's first
 * GET-servable format (fastest tier), else whatever it declares first.
 */
export function pickFormat(m: Manifest, requested?: string): string {
  const declared = m.render?.formats ?? [];
  const format = requested ?? declared.find((f) => GET_FORMATS.has(f)) ?? declared[0];
  if (!format) throw new UsageError(`${m.id} declares no output formats.`);
  if (declared.length && !declared.includes(format)) {
    throw new UsageError(`${m.id} does not produce "${format}". Declared: ${declared.join(", ")}`);
  }
  return format;
}

/** The format an intermediate chain step hands downstream: svg wherever possible. */
export function pickChildFormat(m: Manifest): string {
  const declared = m.render?.formats ?? [];
  const fmt = declared.includes("svg")
    ? "svg"
    : declared.find((f) => GET_FORMATS.has(f)) ?? declared[0];
  if (!fmt) throw new UsageError(`${m.id} declares no formats, so it cannot feed a chain.`);
  return fmt;
}

/** Free-text match over everything a tool advertises, tags included. */
export function matchesTool(t: Tool, q: string): boolean {
  return !q || `${t.id} ${t.name} ${t.description} ${(t.tags ?? []).join(" ")}`
    .toLowerCase()
    .includes(q);
}

export type ToolFilter = {
  /** Free text over id, name, description and tags. */
  q?: string;
  /** Keep only tools that can produce a picture. */
  image?: boolean;
  /** Keep only tools declaring this exact output format. */
  format?: string;
};

/** Narrow the catalog. All given criteria must hold. */
export function filterTools(tools: Tool[], f: ToolFilter = {}): Tool[] {
  const q = (f.q ?? "").toLowerCase();
  return tools.filter((t) =>
    matchesTool(t, q) &&
    (!f.image || isImageTool(t)) &&
    (!f.format || t.formats.includes(f.format)));
}

/** How a filter reads back to the caller, for the count line. */
function describeFilter(f: ToolFilter): string {
  const parts: string[] = [];
  if (f.image) parts.push("that make an image");
  if (f.format) parts.push(`producing ${f.format}`);
  if (f.q) parts.push(`matching "${f.q}"`);
  return parts.length ? ` ${parts.join(", ")}` : "";
}

/** Split a chain's argv on `--then` into one segment per step. */
export function splitChainSegments(argv: string[]): string[][] {
  const segments: string[][] = [[]];
  for (const a of argv) {
    if (a === "--then") segments.push([]);
    else segments[segments.length - 1]!.push(a);
  }
  return segments;
}

/**
 * A chain destination. A plain slot is a top-level asset input (`image`). A
 * block slot points INSIDE a `blocks` input at one record's field
 * (`deck[1].media1`) - which is where a deck tool keeps its visual slots, so
 * without this a chart can never land on a slide.
 */
export type SlotRef = { input: string; index?: number; field?: string };

// Two spellings of the same thing. The bracket form reads best; the dotted
// form exists because zsh and bash glob on `[1]` and an unquoted
// `deck-builder:deck[1].media1` dies as "no matches found" before the script
// ever runs. Both are unambiguous: a numeric middle segment cannot be a
// `vector` field name, which is the only other dotted key form.
const BLOCK_SLOT_BRACKET = /^([A-Za-z0-9_-]+)\[(\d+)\]\.([A-Za-z0-9_-]+)$/;
const BLOCK_SLOT_DOTTED = /^([A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]+)$/;

/**
 * Read `<input>`, `<input>[<index>].<field>` or `<input>.<index>.<field>`.
 * A field is never inferred: `deck.media1` stays a plain slot, because
 * guessing between a block field and a vector field would silently target the
 * wrong thing.
 */
export function parseSlotRef(slot: string): SlotRef {
  const m = BLOCK_SLOT_BRACKET.exec(slot) ?? BLOCK_SLOT_DOTTED.exec(slot);
  if (m) return { input: m[1]!, index: Number(m[2]), field: m[3]! };
  return { input: slot };
}

/** Every block slot a tool really offers, as the strings a caller may type. */
export function blockSlotIds(m: Manifest): string[] {
  const out: string[] = [];
  for (const inp of m.inputs ?? []) {
    if (inp.type !== "blocks") continue;
    for (const f of inp.fields ?? []) {
      if (f.type === "asset") out.push(`${inp.id}[n].${f.id}`);
    }
  }
  return out;
}

/** Both kinds of destination, for an error message that can actually be acted on. */
function slotHelp(m: Manifest): string {
  const assets = (m.inputs ?? []).filter((x) => x.type === "asset").map((x) => x.id);
  const blocks = blockSlotIds(m);
  const parts: string[] = [];
  if (assets.length) parts.push(`asset inputs: ${assets.join(", ")}`);
  if (blocks.length) parts.push(`block slots: ${blocks.join(", ")} (n is the 0-based record index)`);
  return parts.length ? parts.join("; ") : "no asset inputs - it cannot take another tool's render";
}

/**
 * The records a `blocks` input currently holds for this step: what the caller
 * passed, else the manifest's own default list. Reading the default matters -
 * it is how `--then deck-builder:deck[0].media1` works with no `deck=` at all.
 */
function readBlocks(inputs: Inputs, inp: ManifestInput, toolId: string): Record<string, unknown>[] {
  const key = inputs.find(([k]) => k === inp.id || k === inp.urlKey);
  const raw = key ? key[1] : JSON.stringify(inp.default ?? []);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(
      `${toolId}.${inp.id} is a <blocks> input, so its value must be a JSON array of records. ` +
      `Could not parse what was given.`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new UsageError(`${toolId}.${inp.id} must be a JSON ARRAY of records.`);
  }
  return parsed as Record<string, unknown>[];
}

/**
 * Put a child render into one record's field, returning the inputs with that
 * blocks value rewritten. Everything else in the record is preserved, so a
 * hand-written deck keeps its text.
 */
export function setBlockSlot(
  inputs: Inputs,
  m: Manifest,
  ref: Required<SlotRef>,
  value: string,
): { inputs: Inputs; warnings: string[] } {
  const warnings: string[] = [];
  const inp = (m.inputs ?? []).find((x) => x.id === ref.input || x.urlKey === ref.input);
  if (!inp) {
    throw new UsageError(`"${ref.input}" is not an input of ${m.id}. It offers ${slotHelp(m)}.`);
  }
  if (inp.type !== "blocks") {
    throw new UsageError(
      `${m.id}.${ref.input} is <${inp.type}>, not <blocks>, so it has no [index].field form. ` +
      `Feed it as ${m.id}:${ref.input}.`,
    );
  }
  const field = (inp.fields ?? []).find((f) => f.id === ref.field);
  if (!field) {
    const assetFields = (inp.fields ?? []).filter((f) => f.type === "asset").map((f) => f.id);
    throw new UsageError(
      `"${ref.field}" is not a field of ${m.id}.${ref.input}. ` +
      `Asset fields it does have: ${assetFields.join(", ") || "(none)"}`,
    );
  }
  if (field.type !== "asset") {
    warnings.push(
      `${m.id}.${ref.input}[].${ref.field} is <${field.type}>, not <asset> - the chain may not resolve.`,
    );
  }

  const blocks = readBlocks(inputs, inp, m.id);
  if (ref.index < 0 || ref.index >= blocks.length) {
    throw new UsageError(
      `${m.id}.${ref.input} has ${blocks.length} record(s), so index ${ref.index} does not exist. ` +
      `Valid: 0..${Math.max(0, blocks.length - 1)}.`,
    );
  }
  const record = blocks[ref.index]!;

  // A field only applies to some layouts. Setting it on the wrong one is not an
  // error the tool reports - the visual just never appears - so say it here.
  const layout = typeof record.layout === "string" ? record.layout : undefined;
  if (field.showFor && layout && !field.showFor.includes(layout)) {
    warnings.push(
      `record ${ref.index} has layout "${layout}", which does not show ${ref.field} ` +
      `(it shows on: ${field.showFor.join(", ")}). The render would drop it.`,
    );
  }

  blocks[ref.index] = { ...record, [ref.field]: value };
  const key = inp.urlKey ?? inp.id;
  const next: Inputs = inputs.filter(([k]) => k !== inp.id && k !== inp.urlKey);
  next.push([key, JSON.stringify(blocks)]);
  return { inputs: next, warnings };
}

export type ChainStepSpec = {
  /** Tool id, from the `<id>` or `<id>:<slot>` positional. */
  id: string;
  /** The asset input this step's PARENT render feeds. Absent on step 1. */
  slot?: string;
  inputs: Inputs;
  m: Manifest;
};

export type ChainPlanStep = {
  id: string;
  inputs: Inputs;
  /** Set on every step but the last: the embed URL handed downstream. */
  childUrl?: string;
  childFormat?: string;
  /** Set on the last step only: the format actually rendered to a file. */
  finalFormat?: string;
};

export type ChainPlan = {
  steps: ChainPlanStep[];
  /** Non-fatal problems worth telling the caller about. */
  warnings: string[];
  /** Human-readable progress lines, in order. */
  progress: string[];
};

/** A URL past this is at real risk of being refused; servers cap around 8k. */
export const CHAIN_URL_WARN_CHARS = 4000;

const SIZE_KEYS = new Set(["width", "w", "height", "h"]);

/**
 * Assemble a chain into a plan, without rendering anything.
 *
 * Each step's render becomes the next step's named asset input, as a portable
 * embed URL built and encoded here. Steps are also fitted to the NEXT tool's
 * canvas: a child rendered at a different aspect ratio than the slot it lands
 * in gets zoom-cropped, which is the classic "my chart lost its axis labels"
 * chain bug. An explicit width/height on a step turns the fitting off for it.
 */
export function planChain(
  steps: ChainStepSpec[],
  opts: { catalogHost: string; requestedFormat?: string },
): ChainPlan {
  if (steps.length < 2) {
    throw new UsageError(
      "chain needs at least two steps:\n" +
      "  chain <maker-id> k=v ... --then <placer-id>:<asset-input> k=v ... -o out.png",
    );
  }
  const warnings: string[] = [];
  const progress: string[] = [];
  const plan: ChainPlanStep[] = [];
  let childUrl = "";

  for (let i = 0; i < steps.length; i++) {
    const { id, slot, m } = steps[i]!;
    let inputs: Inputs = [...steps[i]!.inputs];

    if (i > 0) {
      if (!slot) {
        throw new UsageError(
          `Step ${i + 1} must name the input to feed, as ${id}:<slot>. ${id} offers ${slotHelp(m)}.`,
        );
      }
      const ref = parseSlotRef(slot);
      if (ref.field !== undefined) {
        const res = setBlockSlot(inputs, m, ref as Required<SlotRef>, childUrl);
        inputs = res.inputs;
        warnings.push(...res.warnings);
      } else {
        const inp = (m.inputs ?? []).find((x) => x.id === slot || x.urlKey === slot);
        if (!inp) {
          throw new UsageError(`"${slot}" is not an input of ${id}. It offers ${slotHelp(m)}.`);
        }
        if (inp.type === "blocks") {
          throw new UsageError(
            `${id}.${slot} is a <blocks> list, so name the record and field: ` +
            `${id}:${slot}[0].<field>. Available: ${blockSlotIds(m).join(", ") || "(no asset fields)"}`,
          );
        }
        if (inp.type !== "asset") {
          warnings.push(`${id}.${slot} is <${inp.type}>, not <asset> - the chain may not resolve.`);
        }
        inputs.push([inp.urlKey ?? inp.id, childUrl]);
      }
    }

    if (i < steps.length - 1) {
      const next = steps[i + 1]!;
      const nextRef = next.slot ? parseSlotRef(next.slot) : undefined;
      const setsSize = inputs.some(([k]) => SIZE_KEYS.has(k));
      const takesSize = (m.inputs ?? []).some((x) => x.id === "width");
      // Fitting to the next tool's canvas is right for a full-bleed asset input
      // and wrong for a block slot, whose real box is a fraction of the canvas
      // the layout decides. There, leave the child at its own aspect - exactly
      // what happens when a human pastes the link into the slot in the app.
      const canvas = nextRef?.field === undefined ? next.m.render : undefined;
      if (!setsSize && takesSize && canvas?.width && canvas?.height) {
        inputs.push(["width", String(canvas.width)], ["height", String(canvas.height)]);
        progress.push(`  fitted ${id} to ${canvas.width}x${canvas.height} (${next.id}'s canvas)`);
      }
      validateInputs(m, inputs);
      const childFormat = pickChildFormat(m);
      childUrl = embedUrl(opts.catalogHost, id, childFormat, inputs);
      if (childUrl.length > CHAIN_URL_WARN_CHARS) {
        warnings.push(
          `step ${i + 1} URL is ${childUrl.length} chars - nested encoding grows fast and ` +
          `servers cap at ~8k. Shorten the data, or render this step to a file and pass it separately.`,
        );
      }
      progress.push(`step ${i + 1}/${steps.length}: ${id} (${childFormat}) →`);
      plan.push({ id, inputs, childUrl, childFormat });
    } else {
      validateInputs(m, inputs);
      const finalFormat = pickFormat(m, opts.requestedFormat);
      progress.push(`step ${i + 1}/${steps.length}: ${id} (${finalFormat}) →`);
      plan.push({ id, inputs, finalFormat });
    }
  }
  return { steps: plan, warnings, progress };
}

// ── The hybrid: read a render's geometry, then add a layer over it ──────────
//
// Every Lolly render is SVG, which is editable text. The reusable move is
// always the same three steps: find the coordinate space, find the shapes worth
// anchoring to, append your own group. These functions are that, so a caller
// never re-writes throwaway regex per tool.

export type ViewBox = { x: number; y: number; w: number; h: number };

export type SvgGeometry = {
  viewBox: ViewBox | null;
  /** Outer size attributes, which may differ from the viewBox units entirely. */
  width: string | null;
  height: string | null;
  preserveAspectRatio: string | null;
};

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** The opening <svg> tag, which carries the coordinate system. */
function rootTag(svg: string): string {
  return /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
}

export function parseViewBox(value: string | null): ViewBox | null {
  if (!value) return null;
  const n = value.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  return { x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! };
}

/**
 * Read the coordinate space you must annotate in. This is the step that catches
 * people out: a tool asked for width=1500 may still emit a content-fitted
 * viewBox like "-44 -44 408 488", and annotations belong in THOSE units.
 */
export function readGeometry(svg: string): SvgGeometry {
  const root = rootTag(svg);
  return {
    viewBox: parseViewBox(attr(root, "viewBox")),
    width: attr(root, "width"),
    height: attr(root, "height"),
    preserveAspectRatio: attr(root, "preserveAspectRatio"),
  };
}

export type Anchor = {
  /** How it was found: a real rect, or a bounding box computed from a path. */
  kind: "rect" | "path";
  /** data-recolor / id / aria-label, when the tool provides one. */
  label?: string;
  x: number; y: number; w: number; h: number;
  /** Centre, the usual place to aim a leader line or align a chip. */
  cx: number; cy: number;
};

const mk = (kind: Anchor["kind"], x: number, y: number, w: number, h: number, label?: string): Anchor =>
  ({ kind, label, x, y, w, h, cx: x + w / 2, cy: y + h / 2 });

/**
 * Bounding box of a path's coordinates. Curve control points are included
 * rather than solved, so the box can be slightly larger than the drawn shape -
 * fine for anchoring a label, not a substitute for real geometry.
 */
export function pathBBox(d: string): { x: number; y: number; w: number; h: number } | null {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (nums.length < 4) return null;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) { xs.push(nums[i]!); ys.push(nums[i + 1]!); }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The shapes worth anchoring to.
 *
 * Two conventions show up across the catalog and they need different handling:
 *
 * - **Chart tools label their marks** - a d3 bar carries `data-recolor="Estate"`.
 *   When any labelled mark exists, ONLY labelled marks are returned. Otherwise
 *   the glyph outlines of the title (text is exported as paths) swamp the three
 *   bars you actually want.
 * - **Layout tools emit bare geometry** - diagram-builder draws cards as plain
 *   `<path>` rounded rects with no attributes at all, so anchors come from
 *   bounding boxes.
 *
 * A shape covering almost the whole canvas is a background, never an anchor.
 */
export function findAnchors(svg: string, opts: { minSize?: number } = {}): Anchor[] {
  const min = opts.minSize ?? 12;
  const vb = readGeometry(svg).viewBox;
  const canvasArea = vb ? vb.w * vb.h : 0;
  const isBackground = (a: Anchor) => canvasArea > 0 && a.w * a.h >= canvasArea * 0.9;

  const all: Anchor[] = [];
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const t = m[0];
    const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(attr(t, k) ?? NaN));
    if (![x, y, w, h].every(Number.isFinite) || w < min || h < min) continue;
    all.push(mk("rect", x, y, w, h, attr(t, "data-recolor") ?? attr(t, "aria-label") ?? undefined));
  }
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)) {
    const bb = pathBBox(m[1]!);
    if (!bb || bb.w < min || bb.h < min) continue;
    all.push(mk("path", bb.x, bb.y, bb.w, bb.h, attr(m[0], "data-recolor") ?? attr(m[0], "aria-label") ?? undefined));
  }

  // A shape whose centre falls outside the canvas is living in some parent
  // group's local coordinates (glyph outlines do this - a title's letters come
  // out at y=-104). Its numbers mean nothing to a caller placing marks in
  // viewBox units, so it is dropped rather than reported as an anchor.
  const inCanvas = (a: Anchor) =>
    !vb || (a.cx >= vb.x && a.cx <= vb.x + vb.w && a.cy >= vb.y && a.cy <= vb.y + vb.h);

  const real = all.filter((a) => !isBackground(a) && inCanvas(a));
  const labelled = real.filter((a) => a.label);
  return (labelled.length ? labelled : real).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
}

export type Padding = { top?: number; right?: number; bottom?: number; left?: number };

/**
 * Grow the coordinate space, which is how you make room for side notes.
 *
 * Each side defaults to 0 individually: spreading a partial `{right: 292}` over
 * defaults would set the other three to `undefined` and yield a NaN viewBox.
 */
export function padViewBox(vb: ViewBox, pad: Padding): ViewBox {
  const n = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);
  const [top, right, bottom, left] = [n(pad.top), n(pad.right), n(pad.bottom), n(pad.left)];
  return { x: vb.x - left, y: vb.y - top, w: vb.w + left + right, h: vb.h + top + bottom };
}

/**
 * Put a layer over a render without disturbing it.
 *
 * The base keeps its root and its content, so it stays re-renderable from its
 * sidecar; everything you add goes in one identifiable group. Padding grows the
 * viewBox and rewrites width/height to match, so the result does not distort.
 */
export function annotateSvg(
  base: string,
  layer: string,
  opts: { pad?: Padding; id?: string } = {},
): string {
  if (!/<\/svg>\s*$/.test(base)) {
    throw new UsageError("That does not look like an SVG document: no closing </svg>.");
  }
  let out = base;
  const pad = opts.pad;
  if (pad && (pad.top || pad.right || pad.bottom || pad.left)) {
    const geo = readGeometry(base);
    if (!geo.viewBox) throw new UsageError("Cannot pad: the SVG has no viewBox to grow.");
    const vb = padViewBox(geo.viewBox, pad);
    const root = rootTag(base);
    let newRoot = root.replace(/\bviewBox="[^"]*"/, `viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"`);
    // Keep the outer box in step with the new aspect, or the render distorts.
    const wNum = Number(String(geo.width ?? "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(wNum) && wNum > 0) {
      const unit = /px/.test(geo.width ?? "") ? "px" : "";
      const h = Math.round((wNum * vb.h) / vb.w);
      newRoot = newRoot
        .replace(/\bwidth="[^"]*"/, `width="${Math.round(wNum)}${unit}"`)
        .replace(/\bheight="[^"]*"/, `height="${h}${unit}"`);
    }
    out = out.replace(root, newRoot);
  }
  const id = opts.id ?? "annotations";
  const body = /^\s*<g[\s>]/.test(layer) ? layer : `<g id="${id}">\n${layer}\n</g>`;
  return out.replace(/<\/svg>\s*$/, `${body}\n</svg>\n`);
}

/** `probe`: what a caller needs before writing a single annotation. */
export function formatProbe(svg: string, anchors: Anchor[]): string[] {
  const geo = readGeometry(svg);
  const lines: string[] = [];
  const vb = geo.viewBox;
  lines.push(vb
    ? `viewBox: ${vb.x} ${vb.y} ${vb.w} ${vb.h}   (annotate in THESE units)`
    : "viewBox: none - the SVG uses raw user units");
  lines.push(`outer:   width=${geo.width ?? "?"} height=${geo.height ?? "?"}${geo.preserveAspectRatio ? `  preserveAspectRatio=${geo.preserveAspectRatio}` : ""}`);
  // Only compare absolute sizes: a width of "100%" is not a pixel count, and
  // reading it as one produces a nonsense mismatch note.
  if (vb && geo.width && /^\s*[\d.]+\s*(px)?\s*$/.test(geo.width)) {
    const wNum = Number(geo.width.replace(/[^\d.]/g, ""));
    if (Number.isFinite(wNum) && Math.abs(wNum - vb.w) > 1) {
      lines.push(`note:    outer width ${wNum} != viewBox width ${vb.w} - the render is content-fitted, so place marks in viewBox units, not pixels.`);
    }
  }
  lines.push(`anchors: ${anchors.length} (top to bottom)`);
  for (const a of anchors) {
    lines.push(`  ${a.kind.padEnd(4)} ${(a.label ?? "-").padEnd(24)} x=${a.x.toFixed(0)} y=${a.y.toFixed(0)} w=${a.w.toFixed(0)} h=${a.h.toFixed(0)}  centre=(${a.cx.toFixed(0)},${a.cy.toFixed(0)})`);
  }
  if (!anchors.length) {
    lines.push("  (none - a continuous render like a gradient, or a text-only card.");
    lines.push("   Place marks against the viewBox box itself, or --min-size lower to see smaller shapes.)");
  }
  return lines;
}

// ── Output formatting (pure, so what the caller reads is testable) ──────────

/** `catalog`: the whole surface, grouped by the catalog's own category. */
export function formatCatalog(tools: Tool[], f: ToolFilter, host: string): string[] {
  const hits = filterTools(tools, f);
  const groups = new Map<string, Tool[]>();
  for (const t of hits) {
    const key = t.category ?? "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const lines: string[] = [];
  for (const key of [...groups.keys()].sort()) {
    lines.push(`\n## ${key}`);
    for (const t of groups.get(key)!.sort((a, b) => a.id.localeCompare(b.id))) {
      const flag = t.status === "experimental" ? " [experimental: watermarked]" : "";
      lines.push(`  ${t.id}  _v=${t.version ?? "?"}${flag}\n      ${t.description}`);
    }
  }
  lines.push(`\n${hits.length} tools${describeFilter(f)} on ${host}.`);
  lines.push("Next: describe <id> for its real inputs. Never guess input ids.");
  return lines;
}

/** `tools`: a flat list with formats, for picking one. */
export function formatToolList(tools: Tool[], f: ToolFilter, host: string): string[] {
  const hits = filterTools(tools, f).sort((a, b) => a.id.localeCompare(b.id));
  if (!hits.length) return [`No tool${describeFilter(f)} on ${host}`];
  return hits.map(
    (t) => `${t.id}  [${t.status}]  _v=${t.version ?? "?"}  formats: ${t.formats.join(",")}\n    ${t.description}`,
  );
}

/**
 * One authored-example value, printed so it can be COPIED onto the command
 * line. A `blocks` value is an array of records, and stringifying it plainly
 * yields "[object Object]" - which is exactly the useless output that hid
 * deck-studio's examples. JSON is what the URL carries, so JSON is what prints.
 */
export function exampleValue(v: unknown): string {
  if (typeof v === "string") return v.replace(/\n/g, "\\n");
  if (v !== null && typeof v === "object") return JSON.stringify(v).replace(/\n/g, "\\n");
  return String(v);
}

/** `describe`: inputs, defaults, formats, and the author's own examples. */
export function formatDescribe(m: Manifest): string[] {
  const lines: string[] = [`${m.id} - ${m.name}  [${m.status ?? "official"}]`];
  if (m.description) lines.push(m.description);
  lines.push(`formats: ${(m.render?.formats ?? []).join(", ")}`);
  if (m.render?.width) lines.push(`canvas: ${m.render.width}x${m.render.height}`);
  if (m.render?.export === false) lines.push("NOTE: non-exporting utility - no file output.");
  if (m.status === "experimental") lines.push("NOTE: experimental - exports carry a watermark.");
  lines.push("inputs:");
  for (const inp of m.inputs ?? []) {
    const opts = inp.options
      ? ` options: ${inp.options.map((o) => (typeof o === "string" ? o : o.value)).join("|")}`
      : "";
    const dflt = inp.default !== undefined ? ` default: ${JSON.stringify(inp.default)}` : "";
    const key = inp.urlKey ? ` (urlKey: ${inp.urlKey})` : "";
    // A vector input has no single-param form - each field is a dotted param.
    const vec = inp.type === "vector" ? `  (pass fields as ${inp.id}.<field>=n)` : "";
    lines.push(`  ${inp.id}${key}  <${inp.type}>${dflt}${opts}${vec}`);
    // A blocks input is a JSON array of records, and only these fields exist
    // inside one. Without them a caller invents field names that fail silently.
    for (const f of inp.type === "blocks" ? inp.fields ?? [] : []) {
      const fopts = f.options
        ? ` options: ${f.options.map((o) => (typeof o === "string" ? o : o.value)).join("|")}`
        : "";
      const chain = f.type === "asset" ? `  <- chain here: ${inp.id}[n].${f.id}` : "";
      const only = f.showFor ? `  only on: ${f.showFor.join(",")}` : "";
      lines.push(`      .${f.id}  <${f.type}>${fopts}${only}${chain}`);
    }
  }
  // The tool author's own presets: a combination already known to render well,
  // which beats inventing a look out of single inputs.
  if (m.examples?.length) {
    lines.push("\nauthored examples (copy one, then change the data):");
    for (const ex of m.examples) {
      const kv = Object.entries(ex.values ?? {})
        .map(([k, v]) => `${k}=${exampleValue(v)}`)
        .join(" ");
      lines.push(`  [${ex.label ?? "example"}] ${kv}`);
    }
  }
  return lines;
}
