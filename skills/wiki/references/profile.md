# Profile mode - voice profiles via idiolect

The wiki does not capture voice itself. The `idiolect` skill does: it builds a
versioned voice profile from the owner's real writing or a guided interview,
and it maintains that profile through feedback. This file is only the glue
between the wiki and idiolect.

## Where profiles live

Idiolect profiles live at the wiki root, one directory per named voice:

```
profiles/<name>/
  voice.md          # stable core: portrait, dimensions, mechanics, lexicon
  quality.md        # what "good" means per format
  ban-list.md       # owner-declared banned words (machine-scannable bullets)
  registers/*.md    # per-context overlays: blog, linkedin, whitepaper, talk...
  evidence.md       # sample ledger, observations, interview record
  changelog.md      # dated history of every durable change
```

The active profile is named by the `voice_profile:` key in the wiki's
`CLAUDE.md`. `none` means no profile yet; composing then uses a plain neutral
style and `scripts/voice-lint.ts` falls back to its built-in kill list.

## Running a profile build or change

1. **Load the bundled idiolect skill**: `.claude/skills/idiolect/SKILL.md`.
   If it is missing, re-run `bun scripts/setup.ts .` - setup bundles or
   installs idiolect automatically.
2. **Follow idiolect's own onboarding and modes** (Create, Apply, Critique,
   Refine). Idiolect owns the method: corpus rules, the interview, the rubric,
   the feedback loop. Do not improvise a parallel interview here.
3. **Point idiolect at `profiles/`** as the profiles directory.
4. **Honor idiolect's sample boundary inside the wiki.** `raw/` and `wiki/`
   are full of other people's writing and agent-written pages. Never treat
   them as voice samples. Use only files the owner explicitly names as their
   own authentic writing.
5. **Registers worth offering first**: the formats this wiki composes, named
   exactly as compose mode looks them up - `blog`, `linkedin`, `whitepaper`,
   `talk` (slide speaker notes). A doc template can get a register of its own
   name (`pov`, `amazon-6pager`) when the general `whitepaper` overlay is not
   enough. Only deltas from the core. The full lookup table is in
   references/compose.md.

## After any profile change

1. If a new profile was created or the active one renamed, set
   `voice_profile:` in the wiki's `CLAUDE.md` to its name.
2. Log it: `bun scripts/wiki.ts log profile "<what changed>"`.
3. Git commit. Idiolect's own changelog entry (in the profile) plus the wiki
   log entry together are the audit trail.

## Legacy wikis

Older wikis carry `profile/voice.md` and `profile/quality-and-style.md` from
the retired template mechanism. Do not delete them silently. Offer to migrate:
idiolect treats them as one existing owner-approved profile, rebuilds it as
`profiles/<name>/` through its Create/Critique flow, and the old `profile/`
folder is removed in the same commit once the owner approves the new one.
Until migration, `voice-lint.ts` still reads the old kill list.
