# What you can load, and how the app reads it

Everything happens on the device. No file leaves it.

## The book slot (one file)

| Format | How chapters and sections are found | Notes |
| --- | --- | --- |
| PDF | 1. The PDF's own bookmarks (outline), if it has them. 2. Otherwise font sizes: the largest recurring size becomes chapter titles, the next becomes section titles. 3. Otherwise fixed page groups. | You can switch between the available structures in the Library. Scanned PDFs have no text; run them through OCR first (e.g. `ocrmypdf in.pdf out.pdf`). |
| EPUB | Each file in the reading order is a chapter; `h2` headings inside it are sections. | Best structure of all formats. |
| Word (.docx) | Heading 1 = chapter, Heading 2 = section. | Needs real heading styles, not bold text. |
| HTML | The highest heading level present = chapters, the next = sections. | |
| Markdown / text | `#` = chapter, `##` = section. | A ZIP of several `.md` files is read in name order. |
| ZIP | Opened; the best book file inside is used (EPUB, then Word, PDF, HTML, Markdown). | |

Sections longer than about 1100 words are split into parts so that slide linking and practice stay focused. Section ids are derived from the titles, so loading the same file on another device gives the same ids and your notes line up.

## The slides slot (as many files as you like)

| Format | What you get |
| --- | --- |
| PDF | Each page rendered as a slide, text extracted per page. |
| PowerPoint (.pptx) | Text of each slide (title and body). Slides are shown as text, not as the designed picture; export the deck to PDF from PowerPoint if you want the picture. |
| Markdown / HTML | Slides separated by `---` or `<section>`. |
| ZIP | Every deck inside is imported. |

Slides that are only images (no text layer) cannot be linked automatically; use "Find in book" to link them by hand.

## How slides get linked to the book

Each slide's text is run as a query against every section of the book (BM25 ranking). The top sections are linked when they match clearly: a relative score of at least 0.55 against the best match and at least two or three shared terms. You can add links with "Find in book" and remove your own.

## What the explanation is

"From the book" shows, for each linked section, the sentences of that section that share the most terms with the slide, in reading order, with the shared terms highlighted, and a button to open the whole section. It is extraction, not generation: the app never invents an explanation. With your own API key, the optional AI coach can write a short explanation from those same passages only.

## Exports (Files page)

Generated on the device from the parsed book: EPUB, HTML, Markdown, and a ZIP with all of them plus the original. PDF: the original if you loaded one; otherwise Print → Save as PDF from the HTML view.
