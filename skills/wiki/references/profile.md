# Profile mode - capturing voice and quality

Goal: `profile/voice.md` (how the user sounds) and `profile/quality-and-style.md` (what "good" means per format). Templates: `templates/voice-template.md`, `templates/quality-template.md`. Filled examples for calibration: `examples/voice-example.md`, `examples/quality-example.md` (a fictional persona - never present it as the user's).

## Fast path: writing samples first

Before interviewing, ask: "Do you have 3-5 things you wrote yourself - posts, emails, a blog? Paste them or point me to the files." Real text beats self-description. Draft the voice profile from the samples, then run only the interview questions the samples cannot answer (beliefs, hard NOs, kill list), and confirm the draft section by section.

## Interview (no samples, or to fill gaps)

Rules of the room: one question at a time, plain language, ~15 minutes total. **Every question comes with 3 sample answers in 3 distinct personas**, so the user can pick one, mix them, or answer freely. Keep the personas consistent all the way through:

- **A - the warm teacher**: explains at the kitchen table, personal stories, plain words.
- **B - the sharp analyst**: leads with the claim, evidence-first, no decoration.
- **C - the playful storyteller**: openings with a scene, humor, vivid detail.

Example of the format:

> **How do you want a piece to open?**
> A: "With a real moment. 'Last week a customer asked me...' - then the lesson."
> B: "With the conclusion. State the point in sentence one, then prove it."
> C: "With a scene. Drop the reader somewhere concrete, make them curious."
> Pick one, mix them, or say it your own way.

The 14 questions (each maps to a template section):

1. Who are you writing for, and what should they feel after reading? (Core identity)
2. What do you believe about your field that most peers would push back on? (Beliefs)
3. Pick a hill you would die on publicly. How do you deliver a strong position? (Beliefs)
4. How do you want a piece to open? (Mechanics)
5. How do you close - question, summary, call to action? (Mechanics)
6. Short punchy sentences, longer flowing ones, or a mix? Paragraph size? (Mechanics)
7. Which words or phrases make you cringe and must never appear? (Kill list)
8. Which words feel like home - the ones you actually say? (Loved words)
9. Formatting: bold? italics? emojis? headers? lists? (Mechanics)
10. What instantly makes you distrust a piece of writing by someone else? (Aesthetic crimes)
11. Humor: none, dry, wordplay, self-deprecating? How often? (Personality)
12. Do you tell stories or personal examples? Named or anonymized? (Personality)
13. Topics or styles that are absolute no-go areas? (Hard NOs)
14. If an AI wrote as you, what is the one instruction you would give it? (Calibration)

## Writing the files

1. Fill `templates/voice-template.md`. Label every rule **HARD RULE** (never break), **STRONG TENDENCY** (~70-80% of the time) or **LIGHT PREFERENCE** (judgment), and keep the anti-overfitting section - it prevents caricature.
2. For quality: ask which formats matter (blog, LinkedIn, whitepaper, slides), then propose rules per format from `templates/quality-template.md` for the user to approve or edit - this doc is more proposal-driven than the voice interview.
3. Read the draft back in one short sample paragraph written in the captured voice: "Does this sound like you?" Iterate until yes.
4. Save to `profile/`, log entry, git commit. Remind the user they can deepen any section later.
