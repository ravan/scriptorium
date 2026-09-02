# Setup mode

Goal: a ready wiki folder, dependencies installed, schema in place, profile started.

## 1. Dependencies (consent first)

Check in this order. For each missing tool: one plain sentence on what it is and why, then a yes/no question. Never install without a yes.

1. **bun** - `command -v bun`. If missing: "I need to install bun, a small tool that runs the wiki's helper scripts. OK to install?" Then run `curl -fsSL https://bun.sh/install | bash` and make sure `~/.bun/bin` is on PATH for subsequent commands (`export PATH="$HOME/.bun/bin:$PATH"`).
2. **Everything else** - run `bun <skill>/scripts/doctor.ts`. It lists missing tools with exact install commands (poppler via brew, etc.). Ask once, install what was approved, re-run doctor to confirm.

## 2. Ask three things, decide the rest

- **Name**: "What should the wiki be called?"
- **Brand** (only if they will want styled slides/docs): "Do you have a brand skill for styling outputs?" Default: none.
- **Bundled skills**: "Shall I copy the `lolly` (visuals) and `<brand>` skills into the wiki folder, so it works on its own?" Default: **yes**, and name the skills you can actually see beside the wiki skill or in `~/.claude/skills/`.

Location default: `~/Wikis/<name>` (kebab-case the name). A user-supplied path wins.

### Why bundling matters

A wiki is a folder the user opens on its own - they start a session *inside* it, not in the folder where the skills are installed. A wiki whose `CLAUDE.md` names a visuals or brand skill that the session cannot load fails at the first compose with "the `lolly` skill could not be found", and the agent then hand-draws an off-brand substitute instead. Bundling copies each skill to `<wiki>/.claude/skills/<name>`, where any session started in the wiki finds it by name.

Bundle the visuals skill and the brand skill. Do not bundle the `wiki` skill itself - the wiki's own `CLAUDE.md` and `scripts/` already carry everything it needs.

### The two voice skills are bundled automatically

Setup always bundles both, with no flag:

- **`idiolect`** builds and maintains voice profiles: `profiles/<name>/` in the wiki, or `~/.idiolect/profiles/<name>/` shared across projects (see references/profile.md).
- **`hogwash`** scans prose for machine-writing artifacts and runs the rewrite loop - only on request, for a piece the user says is going to a wider audience. Never on wiki pages.

They ship from the same repo, so the official install for each is the skills CLI:

```
npx skills add ravan/hogwash --skill idiolect
npx skills add ravan/hogwash --skill hogwash
```

Setup runs that itself when it needs to, which needs the network once. Before doing so it prefers a copy already installed beside the wiki skill or in `~/.claude/skills/`, so a machine that is *developing* these skills keeps its own build; re-running setup is then how a wiki picks up the newer local version. Mention the install in the consent sentence before running setup ("I will also set up idiolect and hogwash, the skills that learn how you write and keep the prose sounding like you"). If setup prints a could-not-install warning, run the matching npx command from the wiki folder once you are online, then re-run setup.

A bundled skill is always a **real directory**, never a symlink, even when the source is symlinked in. Otherwise the wiki would point outside itself and break the moment it moved. `node_modules` is not copied; hogwash installs its own on first use.

Setup writes **no `hogwash.json`**. Hogwash's own defaults apply without one: its rule packs carry the machine-writing ban list, and it resolves its profile at `profile/` in the wiki, then `~/.idiolect/profile/`. The owner's idiolect profile (their added bans and voice) reaches hogwash through that path: a symlink `~/.idiolect/profile -> ~/.idiolect/profiles/<name>` makes the named profile hogwash's default everywhere, with no config. `doctor.ts` reports whether the path resolves. The `mechanics` pack is off by default; a wiki that wants it runs `bun .claude/skills/hogwash/scripts/hogwash.ts init` and edits the file it writes. Setup never overwrites or creates that file.

## 3. Scaffold

```
bun <skill>/scripts/setup.ts ~/Wikis/<name> --name "<Name>" [--brand <brand-skill>] [--bundle-skills lolly,<brand-skill>] [--voice-profile <name>]
```

Idempotent: safe to re-run, never overwrites content. It creates the folders, the manifest, seeds `wiki/log.jsonl`, the wiki `CLAUDE.md` (from `templates/wiki-claude.md`), copies `scripts/` in (refreshing skill-owned scripts), copies the shipped `templates/` (adding what is new, **keeping any template file the user edited**), copies any `--bundle-skills` plus `idiolect` and `hogwash` into `.claude/skills/` (refreshed the same way, minus `node_modules`/`.cache`), writes a `.gitignore` (page renders, gated junk and render intermediates stay out of git - all regenerable), runs `bun install`, generates `wiki/index.json` + `wiki/map.json` via `links.ts`, and makes the first git commit.

On a re-run it commits only what it created or changed, never the user's half-written pages. Flags on a re-run:

- `--brand`, `--slide-template`, `--voice-profile`, `--name` update that one line of the wiki's `CLAUDE.md`.
- `--refresh-templates` overwrites template files the user edited with the skill's current copy (setup names the kept files each run, so nothing is lost in silence).
- `--refresh-schema` rebuilds `CLAUDE.md` from the current template, keeping the wiki's config values; the old file is kept as `CLAUDE.md.prev` for anything added by hand.

Run the **skill's** `setup.ts` for a refresh. The wiki's own `scripts/setup.ts` works too - it finds the skill through `scripts/skill-origin.json` (written by the last run) or `~/.claude/skills/wiki` - but if it finds neither it says so and refreshes nothing.

`--bundle-skills` takes a comma-separated list, found beside the wiki skill or in `~/.claude/skills/`. A name it cannot find is a warning, not a failure - read the warning, since a silently unbundled skill is the exact problem this solves. **Re-running setup with `--bundle-skills` is also how an existing wiki picks up a newer version of a bundled skill**, so re-run it after the skill changes.

## 4. Profile

Voice is an idiolect profile, `profiles/<name>/` in the wiki or `~/.idiolect/profiles/<name>/` shared across projects, created and maintained by the bundled `idiolect` skill - see references/profile.md. Offer to build one now ("shall I learn how you write?"); if the user has past writing they can point at, idiolect starts from that, otherwise it runs its guided interview. It is fine to defer the profile until the first compose; ingest does not need it. When a profile exists, set `voice_profile:` in the wiki's `CLAUDE.md` to its name: pass `--voice-profile <name>` to setup (on a fresh or existing wiki, it sets that line) or edit the line.

## 5. Hand-over sentence

Tell the user in plain words: where the wiki lives, that they drop files into `raw/` (any subfolders they like), and that they say "ingest" when ready.
