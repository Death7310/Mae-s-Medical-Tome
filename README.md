# Mae's Medical Tome

An offline-first study app. You load **your book** (PDF, EPUB, Word, HTML, Markdown or ZIP) and **your lecture slides** (PDF, PowerPoint, Markdown, HTML or ZIP). The app reads the book, detects its chapters and sections, links every slide to the passages its wording matches, shows what the book says about each slide, and coaches you to explain each one in your own words before it shows you anything. One codebase runs on Windows, Android and Huawei phones; study data moves between devices with a code you send yourself. No account, no server, no bundled content.

| Platform | How it runs |
| --- | --- |
| Windows 10/11 | Installable app from Edge or Chrome (Progressive Web App). Own window, Start-menu entry, works offline. |
| Android | Installable from Chrome ("Add to Home screen" / "Install app"), or the APK built by CI: `https://github.com/Death7310/Mae-s-Medical-Tome/releases/latest/download/maes-medical-tome.apk` |
| Huawei / HarmonyOS | Installable from Huawei Browser ("Add to → Home screen"), or the same APK. No Google services required. |

## What it does

- **Two slots, any format**: one for books, one for slides. Drop files in; the app does the rest. See [`docs/FILES.md`](docs/FILES.md) for how each format is read.
- **A real library**: load as many books and decks as you like. Each is listed with its detected structure, can be opened or deleted, and books are ordered by priority: when a slide matches passages in several books, the higher one wins and is listed first. A book can also be kept for reading but excluded from linking.
- **Structure from the book itself**: chapters and sections come from the PDF's bookmarks, from heading sizes, or from the document's headings. For PDFs you can switch structure if the detection looks wrong.
- **Slides linked to the book automatically**: each slide is matched to the sections whose wording it shares. "From the book" shows the matching sentences of your own book with the shared terms highlighted, never invented text.
- **Teach it back, on every slide and every section**: write the explanation first, in your own English. The coach checks coverage of the section's terminology and the writing itself (run-ons, capitals, spelling, vague words, hedging, missing mechanism), gives escalating hints, and holds the book's explanation back until you have tried.
- **Optional AI coach**: with your own Anthropic API key, Claude reads only your answer and the linked passages and gives Socratic feedback with quoted grammar corrections, or writes a short explanation from the passages. Off by default.
- **Files**: the book exported as EPUB, HTML, Markdown and ZIP, generated on the device, plus the originals.
- **Sync without a server**: notes, written answers, progress and your links travel as a code by e-mail, chat, QR or file. Load the same files on both devices and everything lines up.

## Quick start

```bash
npm install
npx playwright install chromium   # once; only needed to produce PDF files
npm run dev                        # http://localhost:5173
```

```bash
npm run build      # builds content + app into dist/
npm run preview    # serve dist/ locally
npm test           # unit tests (sync codec, parsers, search)
node scripts/smoke.mjs   # end-to-end check of dist/ in headless Chromium
```

The app must be served over HTTPS (or localhost) for installation and offline mode to work. The included GitHub Actions workflows publish it to GitHub Pages and build the Android APK on every push.

## Links

- Web app (GitHub Pages, once enabled in the repository settings): `https://death7310.github.io/Mae-s-Medical-Tome/`
- Android / Huawei APK (rebuilt on every push): `https://github.com/Death7310/Mae-s-Medical-Tome/releases/latest/download/maes-medical-tome.apk`

## Deploying

1. Push to GitHub and enable **Settings → Pages → Source: GitHub Actions**.
2. The workflow in `.github/workflows/deploy.yml` builds the content and the app and publishes `dist/`.
3. Open `https://<user>.github.io/<repo>/` on each device and install it from the browser menu.

Any static host works (Netlify, Cloudflare Pages, a folder on a web server). Set `VITE_BASE` to the sub-path if the app is not at the root of the domain.

## How the coaching works, and its limits

The offline check is deterministic. Coverage is measured against the terms that distinguish the linked section from the rest of the book; writing checks are rules. It cannot judge whether a paragraph is *true* beyond vocabulary, and it cannot catch every grammatical error. The AI coach exists for exactly that judgement. Chapter detection from PDFs is heuristic: bookmarks are exact, heading sizes usually work for typeset textbooks, and page groups always work but carry no meaning. Scanned PDFs need OCR first.

## Updating the app

Every push rebuilds both the web app and the APK. Inside the app, Settings → Updates shows the running build and a **Check for updates** button; the app also checks on launch (at most every six hours) and shows a banner.

- **Web / installed PWA**: "Update now" fetches the new service worker and reloads. A few seconds, nothing stored is touched.
- **Android APK**: "Download and install" fetches the newest APK from the project's releases and hands it to Android's installer, which asks for one confirmation. Because every build is signed with the same key, it installs over the old one and keeps the book, slides, notes and progress. Android does not let a sideloaded app replace itself without that tap.

## How sync works, and its limits

The sync code is your study data serialised to JSON, compressed, base64url-encoded and wrapped as `MMT1.<checksum>.<payload>.`. Typical size is a few hundred characters to a few kilobytes. It is not encrypted; treat it like the notes it contains. Merging is per item by timestamp, so syncing in both directions whenever you switch devices keeps both in step. What is **not** in the code: the book and slide files themselves (load the same files on each device; the code carries their fingerprints and warns if they differ) and appearance settings.

If you later want automatic background sync, the data model already carries timestamps per item, so a small sync endpoint or a shared folder adapter can be added without changing the app's storage.

## Layout of the code

```
scripts/build-content.mjs   content pipeline: Markdown -> JSON, HTML, EPUB, ZIP, PDF (Chromium), PPTX
scripts/smoke.mjs           end-to-end smoke test
src/main.js                 shell + hash router + service-worker registration
src/lib/sync.js             sync code codec, merge, QR chunking (pure, unit-tested)
src/lib/coach.js            coaching engine: rubric matching, key-term extraction, writing checks, hints (pure, unit-tested)
src/lib/aicoach.js          optional Claude API coach (learner's own key, browser-direct)
src/lib/search.js           BM25 index used for "Find in book"
src/lib/store.js            IndexedDB-backed state with timestamps
src/lib/content.js          loads built content; imported decks
src/lib/pdf.js              pdf.js wrapper
src/views/*.js              home, reader, slides, practice (teach-it-back box), downloads, sync, settings
vite.config.js              PWA manifest and offline caching rules
```

## Licence

MIT. Your books and slides stay yours and never leave your device.
