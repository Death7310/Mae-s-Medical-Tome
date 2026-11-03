# Mae's Medical Tome

An offline-first study app that holds **the book**, **the lecture slides**, and **explanations that tie every slide back to the book**. One codebase runs on Windows, Android and Huawei phones, and study data moves between devices with a code you send yourself, with no account and no server.

| Platform | How it runs |
| --- | --- |
| Windows 10/11 | Installable app from Edge or Chrome (Progressive Web App). Own window, Start-menu entry, works offline. |
| Android | Installable from Chrome ("Add to Home screen" / "Install app"). Optional APK via Capacitor (see `docs/NATIVE-PACKAGING.md`). |
| Huawei / HarmonyOS | Installable from Huawei Browser ("Add to → Home screen"). No Google services required. The same optional APK sideloads or ships through AppGallery. |

## What it does

- **Book reader**: chapters split into addressable sections, with bookmarks, "studied" marks and per-section notes. Each section shows which slides rest on it.
- **Slide study view**: renders each deck's PDF page by page. Beside each slide: the book sections it is linked to, an explanation written against the book text, and the full section text one tap away. Unlinked slides get ranked suggestions from a full-text search of the book, and you can link them yourself.
- **Downloads**: the book as PDF, EPUB, ZIP, HTML and Markdown; each deck as PDF and PPTX; all generated from one source so they never disagree. Any file can be kept inside the app for offline use or shared to another app.
- **Sync without a server**: export notes, progress, bookmarks and your slide links as a compact code. Send it by e-mail, chat, QR code or file. Import on the other device and it merges, newest entry wins, nothing deleted.
- **Bring your own deck**: import any lecture PDF on a device. It stays local (too large for codes), but your notes and links for it still sync.

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

The app must be served over HTTPS (or localhost) for installation and offline mode to work. The included GitHub Actions workflow publishes it to GitHub Pages on every push to `main`; see **Deploying** below.

## Putting the real book and slides in

Everything the app shows is generated from the `content/` folder by `npm run content` (run automatically by `dev` and `build`). The full guide is in [`docs/CONTENT-GUIDE.md`](docs/CONTENT-GUIDE.md). The short version:

```
content/
  book.json                      title, author, chapter order
  book/01-xxx.md                 one Markdown file per chapter, sections start with "## "
  book/book.pdf                  (optional) use this PDF instead of the generated one
  slides/<deck-id>/deck.json     title, source: "slides.md" or "slides.pdf"
  slides/<deck-id>/slides.pdf    the real lecture deck (or slides.md to author one)
  slides/<deck-id>/links.md      per slide: which book sections + the explanation
```

`npm run content -- --ids` prints every section id you can link to.

The repository ships with a short sample volume on cardiovascular physiology and a nine-slide deck so the whole pipeline can be seen working. Replace them.

## Deploying

1. Push to GitHub and enable **Settings → Pages → Source: GitHub Actions**.
2. The workflow in `.github/workflows/deploy.yml` builds the content and the app and publishes `dist/`.
3. Open `https://<user>.github.io/<repo>/` on each device and install it from the browser menu.

Any static host works (Netlify, Cloudflare Pages, a folder on a web server). Set `VITE_BASE` to the sub-path if the app is not at the root of the domain.

## How sync works, and its limits

The sync code is your study data serialised to JSON, compressed, base64url-encoded and wrapped as `MMT1.<checksum>.<payload>.`. Typical size is a few hundred characters to a few kilobytes. It is not encrypted; treat it like the notes it contains. Merging is per item by timestamp, so syncing in both directions whenever you switch devices keeps both in step. What is **not** in the code: the PDFs themselves (built-in ones are the same on every device; imported ones must be imported on each device) and appearance settings.

If you later want automatic background sync, the data model already carries timestamps per item, so a small sync endpoint or a shared folder adapter can be added without changing the app's storage.

## Layout of the code

```
scripts/build-content.mjs   content pipeline: Markdown -> JSON, HTML, EPUB, ZIP, PDF (Chromium), PPTX
scripts/smoke.mjs           end-to-end smoke test
src/main.js                 shell + hash router + service-worker registration
src/lib/sync.js             sync code codec, merge, QR chunking (pure, unit-tested)
src/lib/search.js           BM25 index used for "Find in book"
src/lib/store.js            IndexedDB-backed state with timestamps
src/lib/content.js          loads built content; imported decks
src/lib/pdf.js              pdf.js wrapper
src/views/*.js              home, reader, slides, downloads, sync, settings
vite.config.js              PWA manifest and offline caching rules
```

## Licence

Content in `content/` belongs to its author. Code: MIT.
