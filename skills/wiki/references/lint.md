# Lint mode

Goal: keep the wiki healthy as it grows. Run when asked, or suggest it after every ~10 ingests.

## Start with the two scripts

```
bun scripts/manifest.ts status
bun scripts/links.ts
```

Between them these settle checks 1, 4 and 7 mechanically, so your attention goes to the judgement checks below. `links.ts` reports broken relative links, link targets with an unencoded space, `[[wikilinks]]`, manifest entries pointing at pages that no longer exist, sources marked ingested with no source page, orphans, pages missing their purpose line, and source pages not at their schema name. It exits 1 when anything is actually broken; orphans, missing purpose lines and misnamed source pages are reported but do not fail. It also regenerates `wiki/index.json` and `wiki/map.json`, so the catalog and graph are current by the time you look - `bun scripts/wiki.ts hubs` and `clusters` are a good starting point for checks 5 and 6. Check 7 (index drift) no longer exists: the index is generated from the pages.

**Legacy wikis** (created before the JSON metadata): `links.ts` warns when `wiki/index.md`, `wiki/map.md` or `wiki/log.md` are still present. Convert the log first - each `## [YYYY-MM-DD] <op> | <title>` heading plus its body becomes one line in `wiki/log.jsonl`: `{"at":"<date>T00:00:00.000Z","op":"<op>","title":"<title>","note":"<body, if any>"}`. Then delete all three markdown files (their content is fully replaced by the generated JSON) and commit.

Disk hygiene belongs to lint too: `bun scripts/clean.ts` (dry run) shows derived/ material of ingested sources that can be deleted - gated junk, PDF page renders, unreferenced media. Offer it to the user; `--apply` deletes, and `ingest.ts --re-extract <file>` can regenerate anything later.

## Checks

1. **Stuck sources** - `bun scripts/manifest.ts pending` and any `removed`/`error`/`unsupported` entries in `bun scripts/manifest.ts status`.
2. **Contradictions** - claims that disagree across pages without both being flagged.
3. **Stale claims** - statements superseded by newer sources (compare source dates).
4. **Orphan and broken pages** - from `bun scripts/links.ts`. Decide per orphan: link it from a relevant page, add it to the index, or delete it.
5. **Missing pages** - concepts or entities mentioned on 2+ pages that have no page of their own.
6. **Missing cross-references** - pages that discuss each other's subject without linking.
7. **Weak purpose lines** - `links.ts` flags missing ones; also rewrite purpose lines that no longer describe their page, since they are the search summaries in `index.json`.
8. **Gaps worth filling** - questions the wiki raises but cannot answer; suggest sources or a web search the user could approve.

## Output

Report findings as a short plain-language list, grouped by check, each item with the page link and a proposed fix. Apply the fixes the user approves (or all obviously-safe ones in batch mode: missing cross-references, purpose-line fixes). Finish with `bun scripts/wiki.ts log lint "<summary>"` and a git commit.
