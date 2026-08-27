# Quality & Style Standards: Kai Moreno / Brightharbor content (fictional example)

A filled example of `templates/quality-template.md` for the same fictional persona as `voice-example.md`. Calibration only.

## 1. Style Rules (all formats)

### DO
- Present tense, active voice ("Teams lose an hour a day to..." not "It has been observed that...").
- Lead with the insight, then the evidence.
- Specific numbers with sources ("cut onboarding from 6 weeks to 9 days" beats "dramatically faster").
- Headings that state insights ("The Queue Is the Symptom, Not the Problem"), never labels ("Challenges").
- Every paragraph passes the "so what" test; cut it if removing it changes nothing.
- Vary sentence and paragraph length; a short line after a dense one lands the point.

### DON'T
- Filler ("It is important to note that...", "In today's fast-paced world...").
- Hedge stacking ("somewhat", "arguably", "potentially" in one paragraph).
- Unsupported superlatives ("the best", "the only").
- Sales-pitch tone anywhere in an educational piece.
- Paragraphs over 5 sentences. More than one exclamation mark per piece.

### Tone

Confident practitioner in a working session with a peer: not lecturing, not selling, not hedging. Blog = most personal; whitepaper = same clarity, more evidence; LinkedIn = tightest, warmest.

## 2. Per-Format Rules

### Blog post
- 800-1500 words. Scene opening, mechanism in the middle, boring fix, closing question.
- Title promises a specific outcome or names a specific pain; under 12 words.
- CTA: one soft pointer at the end (a related piece, a checklist), never mid-article.

### LinkedIn post
- 120-250 words, short paragraphs, bold sparsely for skimmers, one visual per post.
- First line must survive the "see more" fold on its own.
- End with a question that invites replies about the reader's situation.

### Whitepaper
- 4-6 pages; one thesis argued well beats five argued thinly.
- 8-15 citations; no source older than 3 years unless historical on purpose.
- Product appears in at most 20-30% of the paper; the rest is genuine analysis.
- CTA only in the final section and the last line of the executive summary.

## 3. Quality Checklist (run before anything ships)

### Strategic
- [ ] One clear, defensible thesis?
- [ ] Target reader learns something they did not know?
- [ ] Passes "why should I care?" in the first 200 words?

### Content
- [ ] Every claim traces to a wiki page or cited source?
- [ ] At least 2 concrete examples or mini-cases?
- [ ] Strongest counterargument addressed?

### Writing
- [ ] Voice profile Never-list clean (kill list, false contrasts, unsourced numbers)?
- [ ] Headings communicate insights?
- [ ] Sentence and paragraph length varied; no three same-length paragraphs in a row?

### Reader experience
- [ ] A skimmer gets the argument from headings alone?
- [ ] Would the reader forward this to a colleague?
- [ ] Readable in one sitting for its format?

## 4. Antipatterns

- **The Brochure in Disguise**: every section bends toward the product. Fix: product in at most 20-30%.
- **The Data Dump**: statistics with no narrative. Fix: each number must advance the argument or go.
- **The Ghost Author**: could have been written by anyone. Fix: one lived incident, one opinion, a named author.
- **The Weak Ending**: trails off with "companies should consider...". Fix: end with numbered, doable steps.

## 5. Production Notes

Styled outputs (slides, docx, SVG) load the brand skill named in the wiki's CLAUDE.md before composing; markdown outputs need only this document and the voice profile. Files go to `outputs/` named `<type>-<topic-slug>-<YYYY-MM>.<ext>`.
