# Lint mode

Goal: keep the wiki healthy as it grows. Run when asked, or suggest it after every ~10 ingests.

## Checks

1. **Stuck sources** - `bun scripts/manifest.ts pending` and any `removed`/`error`/`unsupported` entries in `bun scripts/manifest.ts status`.
2. **Contradictions** - claims that disagree across pages without both being flagged.
3. **Stale claims** - statements superseded by newer sources (compare source dates).
4. **Orphan pages** - pages no other page links to (grep for inbound links).
5. **Missing pages** - concepts or entities mentioned on 2+ pages that have no page of their own.
6. **Missing cross-references** - pages that discuss each other's subject without linking.
7. **Index drift** - pages missing from `wiki/index.md`, or index summaries that no longer match.
8. **Gaps worth filling** - questions the wiki raises but cannot answer; suggest sources or a web search the user could approve.

## Output

Report findings as a short plain-language list, grouped by check, each item with the page link and a proposed fix. Apply the fixes the user approves (or all obviously-safe ones in batch mode: index drift, missing cross-references). Finish with a `## [date] lint | ...` log entry and a git commit.
