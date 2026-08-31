# Setup mode

Goal: a ready wiki folder, dependencies installed, schema in place, profile started.

## 1. Dependencies (consent first)

Check in this order. For each missing tool: one plain sentence on what it is and why, then a yes/no question. Never install without a yes.

1. **bun** - `command -v bun`. If missing: "I need to install bun, a small tool that runs the wiki's helper scripts. OK to install?" Then run `curl -fsSL https://bun.sh/install | bash` and make sure `~/.bun/bin` is on PATH for subsequent commands (`export PATH="$HOME/.bun/bin:$PATH"`).
2. **Everything else** - run `bun <skill>/scripts/doctor.ts`. It lists missing tools with exact install commands (poppler via brew, etc.). Ask once, install what was approved, re-run doctor to confirm.

## 2. Ask three things, decide the rest

- **Name**: "What should the wiki be called?"
- **Brand** (only if they will want styled slides/docs): "Do you have a brand skill for styling outputs?" Default: none.
- **Bundled skills**: "Shall I copy the `lolly` (visuals) and `<brand>` skills into the wiki folder, so it works on its own?" Default: **yes**, and name the skills you can actually see beside the wiki skill.

Location default: `~/Wikis/<name>` (kebab-case the name). A user-supplied path wins.

### Why bundling matters

A wiki is a folder the user opens on its own - they start a session *inside* it, not in the folder where the skills are installed. A wiki whose `CLAUDE.md` names a visuals or brand skill that the session cannot load fails at the first compose with "the `lolly` skill could not be found", and the agent then hand-draws an off-brand substitute instead. Bundling copies each skill to `<wiki>/.claude/skills/<name>`, where any session started in the wiki finds it by name.

Bundle the visuals skill and the brand skill. Do not bundle the `wiki` skill itself - the wiki's own `CLAUDE.md` and `scripts/` already carry everything it needs.

### Idiolect is bundled automatically

The `idiolect` skill owns the wiki's voice profiles (see references/profile.md), so setup always bundles it - no flag needed. It looks for an installed copy beside the wiki skill and in `~/.claude/skills/`; if neither exists it installs it into the wiki with `npx skills add ravan/hogwash --skill idiolect`, which needs the network once. Mention this in the consent sentence before running setup ("I will also set up idiolect, the skill that learns how you write"). If setup prints the could-not-install warning, run that npx command from the wiki folder once you are online, then re-run setup.

## 3. Scaffold

```
bun <skill>/scripts/setup.ts ~/Wikis/<name> --name "<Name>" [--brand <brand-skill>] [--bundle-skills lolly,<brand-skill>] [--voice-profile <name>]
```

Idempotent: safe to re-run, never overwrites content. It creates the folders, the manifest, seeds `wiki/log.jsonl`, the wiki `CLAUDE.md` (from `templates/wiki-claude.md`), copies `scripts/` in (refreshing skill-owned scripts), copies any `--bundle-skills` plus `idiolect` into `.claude/skills/` (refreshed the same way, minus `node_modules`/`.cache`), runs `bun install`, generates `wiki/index.json` + `wiki/map.json` via `links.ts`, and makes the first git commit.

`--bundle-skills` takes a comma-separated list, resolved as sibling folders of the wiki skill. A name it cannot find is a warning, not a failure - read the warning, since a silently unbundled skill is the exact problem this solves. **Re-running setup with `--bundle-skills` is also how an existing wiki picks up a newer version of a bundled skill**, so re-run it after the skill changes.

## 4. Profile

Voice is an idiolect profile under `profiles/<name>/`, created and maintained by the bundled `idiolect` skill - see references/profile.md. Offer to build one now ("shall I learn how you write?"); if the user has past writing they can point at, idiolect starts from that, otherwise it runs its guided interview. It is fine to defer the profile until the first compose; ingest does not need it. When a profile exists, set `voice_profile:` in the wiki's `CLAUDE.md` to its name (or pass `--voice-profile <name>` to setup).

## 5. Hand-over sentence

Tell the user in plain words: where the wiki lives, that they drop files into `raw/` (any subfolders they like), and that they say "ingest" when ready.
