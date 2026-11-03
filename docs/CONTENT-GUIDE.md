# Content guide

The app never edits content at runtime. Everything comes from `content/` and is compiled by `npm run content` into `public/content/*.json` (what the app reads) and `public/downloads/*` (what users download). Commit sources, not outputs.

## 1. The book

`content/book.json`

```json
{
  "id": "maes-medical-tome",
  "title": "Mae's Medical Tome",
  "subtitle": "…",
  "author": "Mae",
  "language": "en",
  "edition": "1st edition, 2026",
  "chapters": ["01-overview.md", "02-cardiac-cycle.md"]
}
```

Each chapter is a Markdown file with a small front-matter block:

```markdown
---
id: cardiac-cycle
title: The Cardiac Cycle
---

Optional introduction before the first section.

## Phases of the cycle

Body text. Sub-headings use ### and deeper.

## Heart sounds
…
```

Rules that matter:

- `## ` headings define **sections**. Sections are the unit everything links to, so keep them meaningful (a concept, not a paragraph). Sub-headings (`###`) stay inside their section.
- A section's id is its heading slugified: `Short-term regulation: the baroreceptor reflex` → `short-term-regulation-the-baroreceptor-reflex`. Run `npm run content -- --ids` to list them.
- Tables, blockquotes, bold, italics, lists and links all work. Images: put them in `public/img/` and reference `/img/name.png` (they are included in HTML/PDF; EPUB image packaging is not implemented yet).
- A section titled `References` is excluded from the search index so citations do not pollute suggestions.

### Converting an existing manuscript

If the book exists as Word or EPUB, convert once with pandoc and then split into chapter files:

```bash
pandoc book.docx -t gfm --wrap=none -o book.md
pandoc book.epub -t gfm --wrap=none -o book.md
```

Then cut `book.md` at chapter boundaries, add the front matter, and make sure chapter-internal headings start at `##`.

### Using the publisher's PDF

Put it at `content/book/book.pdf`. The pipeline then ships that file as the PDF download instead of rendering one, while EPUB/HTML/Markdown are still generated from the Markdown. The reader always uses the Markdown.

## 2. Slide decks

One folder per deck under `content/slides/`:

```
content/slides/cardio-lecture-3/
  deck.json
  slides.pdf        the real lecture deck (preferred)
  slides.pptx       optional; offered as a download if present next to slides.pdf
  links.md          slide -> book links and explanations
```

`deck.json`:

```json
{ "id": "cardio-lecture-3", "title": "Lecture 3: Cardiac Cycle", "lecturer": "Dr X", "course": "Physiology 201", "source": "slides.pdf" }
```

With `"source": "slides.pdf"` the pipeline copies the PDF, extracts the text of every page (used by "Find in book"), and counts the pages. If the PDF is scanned images, no text is extracted and suggestions will be empty for that deck; run it through OCR first (e.g. `ocrmypdf in.pdf out.pdf`).

With `"source": "slides.md"` you author slides in Markdown separated by lines containing only `---`; the pipeline renders a PDF and a PPTX. This is how the sample deck is made.

## 3. Linking slides to the book: `links.md`

```markdown
## Slide 6
sections: cardiac-cycle#heart-sounds

The slide's last line is the key idea: sounds come from closure. The book adds
why S2 splits on inspiration and the clinical meaning of S3 and S4…

## Slide 7
sections: blood-pressure#systolic-diastolic-pulse-and-mean-pressure, blood-pressure#the-haemodynamic-equation

Two formulas, two ideas…
```

- `## Slide N` starts a block for slide N (1-based, matching PDF page numbers).
- `sections:` is a comma-separated list of `chapter-id#section-id`. Unknown ids are reported as warnings at build time and skipped.
- Everything after is the explanation, in Markdown. Write it **against the book**: what the slide compresses, what the section adds, where the exam question usually goes. Keep it to a paragraph or two; the full section text is one tap away in the app.
- Slides without a block still work; the app offers suggestions and users can add their own links on-device.

## 4. Practice questions and rubrics (the coaching layer)

Add three optional sub-sections to a slide's block in `links.md`:

```markdown
## Slide 6
sections: cardiac-cycle#heart-sounds

Explanation text as before…

### Question
Explain what produces the first and second heart sounds and when each occurs.

### Key points
- What causes S1: s1|first heart sound + clos + mitral|tricuspid|atrioventricular|av valve >> Valves make a sound when they do one thing, not the other.
- What causes S2: s2|second heart sound + clos + aortic|pulmonary|semilunar
- When each occurs: systole + diastole >> Each sound marks the start of a phase. Which?

### Model answer
S1 is produced by closure of the mitral and tricuspid valves and marks the start of ventricular systole…
```

How a key point line works:

- `label:` is what the learner sees ("What causes S1"). Write it as the *dimension*, never the answer.
- The pattern after the colon has **groups** separated by `+`. A key point counts as covered only when **every** group is present in the answer.
- Inside a group, `|` separates **alternatives**; any one of them satisfies the group. Matching is case-insensitive and word-start based, so `clos` matches "closure", "closes" and "closing".
- `>> hint` is shown on the second attempt. Make it a pointer, not the content ("Which pressure rises above which?").
- Choose groups so that a correct answer in natural wording passes: list synonyms, abbreviations and both spellings (haemo/hemo). Test your rubric by pasting the model answer into the app; it must score every point.
- Two to six key points per slide is right. The model answer should itself cover all of them in plain, well-formed sentences; it is what the learner compares against after three attempts.

Slides without a `### Question` still get a practice box: a generic "explain this slide" prompt, scored on the terminology of the linked sections and on writing quality. Every book section gets the same treatment under its **Teach it back** button. Authored rubrics coach noticeably better, so write them for the slides that matter most.

Writing checks are rules (length, run-on sentences, capitals, terminal punctuation, a spelling list, "could of", vague words, hedging, missing causal connectives, heavy passive voice). You can extend the spelling list in `src/lib/coach.js`.

## 5. Checking the result

```bash
npm run content          # warnings list unknown section ids and slides without text
npm run build && node scripts/smoke.mjs --shots shots/   # end-to-end check with screenshots
npm test                 # includes the coaching engine's unit tests
```
