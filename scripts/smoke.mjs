// End-to-end smoke test of the built app (dist/) in headless Chromium.
// Generates its own test files (a small textbook as PDF/EPUB/DOCX/HTML and a deck as PDF/PPTX),
// loads them through the Library like a user would, and checks every view.
// Usage: npm run build && node scripts/smoke.mjs [--shots DIR]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const FIX = path.join(ROOT, '.smoke-fixtures');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const BASE_PATH = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');

// ------------------------------------------------------------------ fixtures
const CHAPTERS = [
  ['The Cardiac Cycle', [
    ['Phases of the cycle', 'The cardiac cycle runs from one heartbeat to the next. Ventricular systole begins with isovolumetric contraction, when the mitral valve has closed and the aortic valve has not yet opened, so pressure rises while volume stays constant. Ejection follows when ventricular pressure exceeds aortic pressure. Isovolumetric relaxation begins when the aortic valve closes, and ventricular filling begins when the mitral valve opens because ventricular pressure has fallen below atrial pressure.'],
    ['Heart sounds', 'The heart sounds are caused by closure of the valves. The first heart sound, S1, marks mitral and tricuspid closure at the start of ventricular systole. The second heart sound, S2, marks aortic and pulmonary closure at the start of diastole. A third sound, S3, occurs during rapid filling and is normal in children but suggests a volume-overloaded ventricle in older adults. A fourth sound, S4, occurs when the atrium contracts into a stiff ventricle.'],
    ['Pressure volume loops', 'If ventricular pressure is plotted against volume, each cycle traces an anticlockwise loop. The width of the loop is the stroke volume and the area inside it is the stroke work. Increasing preload widens the loop, increasing afterload makes it taller and narrower, and increasing contractility shifts the end-systolic point up and to the left.'],
  ]],
  ['Arterial Blood Pressure', [
    ['Mean arterial pressure', 'Mean arterial pressure is the time-averaged pressure over the cardiac cycle and drives organ perfusion. Because diastole lasts longer than systole at rest, it is estimated as diastolic pressure plus one third of the pulse pressure. Pulse pressure is systolic pressure minus diastolic pressure and widens when stroke volume rises or the arteries stiffen. For a reading of 120 over 80 the mean arterial pressure is about 93 mmHg.'],
    ['The baroreceptor reflex', 'Stretch receptors in the carotid sinus and the aortic arch fire faster as arterial pressure rises. Carotid sinus signals travel in the glossopharyngeal nerve and aortic arch signals in the vagus nerve to the nucleus tractus solitarius in the medulla. Increased firing inhibits sympathetic outflow and increases parasympathetic outflow, so heart rate, contractility and vascular resistance fall. The baroreceptors reset within one to two days, so the reflex buffers acute swings but cannot set long-term pressure.'],
    ['Long term control', 'Over days to weeks the kidney dominates through pressure natriuresis. A rise in arterial pressure increases renal excretion of sodium and water, blood volume and cardiac output fall, and pressure returns to the level at which excretion matches intake. The renin angiotensin aldosterone system supports pressure over minutes to hours through vasoconstriction, aldosterone release and sodium reabsorption.'],
  ]],
  ['Cardiac Output', [
    ['Definition and values', 'Cardiac output is the volume of blood one ventricle ejects per minute and equals heart rate multiplied by stroke volume. At rest a heart rate near 70 beats per minute and a stroke volume near 70 mL give roughly 5 litres per minute. During exercise cardiac output can rise to 25 litres per minute, mostly through an increase in heart rate.'],
    ['Determinants of stroke volume', 'Stroke volume depends on preload, afterload and contractility. Preload is the stretch of the ventricle at the end of diastole and rises with venous return. Afterload is the load the ventricle must overcome to eject, approximated by aortic pressure. Contractility is the intrinsic strength of contraction at a given preload and afterload and is raised by sympathetic stimulation.'],
    ['Ejection fraction', 'The ejection fraction is stroke volume divided by end-diastolic volume and is normally between 55 and 70 per cent. A reduced ejection fraction is one of the defining measurements of heart failure, because it shows how well the ventricle empties relative to how full it was.'],
  ]],
];
const SLIDES = [
  ['Heart sounds', ['S1: AV valves close, start of systole', 'S2: semilunar valves close, start of diastole', 'S3 rapid filling, normal in the young', 'S4 atrial kick into a stiff ventricle']],
  ['Mean arterial pressure', ['MAP = DBP + 1/3 pulse pressure', '120/80 gives about 93 mmHg', 'Pulse pressure = SBP minus DBP']],
  ['Baroreceptor reflex', ['Carotid sinus and aortic arch stretch receptors', 'Glossopharyngeal and vagus nerves to the nucleus tractus solitarius', 'Resets in one to two days']],
  ['Cardiac output', ['CO = heart rate x stroke volume', 'Rest about 5 litres per minute', 'Exercise up to 25 litres per minute']],
  ['Stroke volume', ['Preload: end-diastolic stretch', 'Afterload: aortic pressure', 'Contractility: sympathetic drive']],
  ['Summary', ['Questions?']],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bookHtml = () => `<!doctype html><html><head><meta charset="utf-8"><title>Test Physiology Book</title><style>body{font-family:Georgia,serif;font-size:11pt;line-height:1.5;max-width:40em;margin:2em auto}h1{font-size:24pt;page-break-before:always;margin-top:0}h2{font-size:16pt;margin-top:1.5em}p{margin:.6em 0}.head{font-size:8pt;color:#777}</style></head><body><h1 class="t">Test Physiology Book</h1><p>Sample book generated by the smoke test.</p>${CHAPTERS.map(([ct, secs]) => `<h1>${esc(ct)}</h1>${secs.map(([st, txt]) => `<h2>${esc(st)}</h2><p>${esc(txt)}</p><p>${esc(txt.split('. ').slice(0, 2).join('. '))}.</p>`).join('')}`).join('')}</body></html>`;
const deckHtml = () => `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:13.333in 7.5in;margin:0}body{margin:0;font-family:Arial,sans-serif}.s{width:13.333in;height:7.5in;padding:.8in 1in;box-sizing:border-box;page-break-after:always}h1{font-size:40pt;color:#0b3d5c}li{font-size:22pt;margin:.3em 0}</style></head><body>${SLIDES.map(([t, b]) => `<section class="s"><h1>${esc(t)}</h1><ul>${b.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`).join('')}</body></html>`;

async function makeFixtures(browser) {
  await fs.rm(FIX, { recursive: true, force: true });
  await fs.mkdir(FIX, { recursive: true });
  await fs.writeFile(path.join(FIX, 'book.html'), bookHtml());
  const page = await browser.newPage();
  await page.setContent(bookHtml());
  await page.pdf({ path: path.join(FIX, 'book.pdf'), format: 'A5', margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' }, displayHeaderFooter: true, headerTemplate: '<div style="font-size:7px;color:#777;width:100%;text-align:center">Test Physiology Book</div>', footerTemplate: '<div style="font-size:7px;color:#777;width:100%;text-align:center"><span class="pageNumber"></span></div>' });
  await page.setContent(deckHtml());
  await page.pdf({ path: path.join(FIX, 'deck.pdf'), width: '13.333in', height: '7.5in', preferCSSPageSize: true, printBackground: true });
  await page.close();
  // EPUB
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const items = [], spine = [];
  CHAPTERS.forEach(([ct, secs], i) => { zip.file(`OEBPS/c${i}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(ct)}</title></head><body><h1>${esc(ct)}</h1>${secs.map(([st, txt]) => `<h2>${esc(st)}</h2><p>${esc(txt)}</p>`).join('')}</body></html>`); items.push(`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`); spine.push(`<itemref idref="c${i}"/>`); });
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="u">x</dc:identifier><dc:title>Test Physiology Book EPUB</dc:title><dc:language>en</dc:language></metadata><manifest>${items.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
  await fs.writeFile(path.join(FIX, 'book.epub'), await zip.generateAsync({ type: 'nodebuffer' }));
  // DOCX
  const d = new JSZip();
  d.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  d.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  d.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  d.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>');
  const para = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  d.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${CHAPTERS.map(([ct, secs]) => para(ct, 'Heading1') + secs.map(([st, txt]) => para(st, 'Heading2') + para(txt)).join('')).join('')}</w:body></w:document>`);
  await fs.writeFile(path.join(FIX, 'book.docx'), await d.generateAsync({ type: 'nodebuffer' }));
  // PPTX
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_16x9';
  for (const [t, b] of SLIDES) { const s = pptx.addSlide(); s.addText(t, { x: 0.5, y: 0.4, w: 9, h: 0.9, fontSize: 30, bold: true, placeholder: 'title' }); s.addText(b.map((x) => ({ text: x, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.5, w: 9, h: 3, fontSize: 18 }); }
  await pptx.writeFile({ fileName: path.join(FIX, 'deck.pptx') });
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(BASE_PATH)) { res.writeHead(404); return res.end('outside base'); }
  p = '/' + p.slice(BASE_PATH.length);
  if (p === '/') p = '/index.html';
  try { const data = await fs.readFile(path.join(DIST, p)); res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data); } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;
console.log(`serving dist/ at ${base}`);

const { chromium } = await import('playwright');
const exe = process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined;
const browser = await chromium.launch(exe && (await fs.access(exe).then(() => true, () => false)) ? { executablePath: exe } : {});
await makeFixtures(browser);
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const shot = async (page, name) => { if (shotsDir) { await fs.mkdir(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, name) }); } };
const noOverflow = async (page, label) => {
  const r = await page.evaluate(() => { const d = document.documentElement; const wide = []; for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (b.right > d.clientWidth + 1 || b.left < -1) wide.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)}`); } return { over: d.scrollWidth > d.clientWidth, x: window.scrollX, wide: wide.slice(0, 6) }; });
  check(!r.over && r.x === 0, `${label}: no horizontal overflow${r.over || r.x ? ' (' + r.wide.join(' | ') + ')' : ''}`);
};
const bookChip = (page) => page.locator('.slot').first().locator('.chip.ok').first();
async function loadBook(page, file) {
  await page.setInputFiles('#book-file', path.join(FIX, file));
  await page.waitForFunction((name) => !document.querySelector('.busy') && (document.querySelector('.slot')?.textContent || '').includes(name) && /\d+ chapters, \d+ sections/.test(document.querySelector('.slot .chip.ok')?.textContent || ''), file, { timeout: 90000 });
  return (await bookChip(page).textContent()).trim();
}
async function loadDeck(page, file) { const before = await page.locator('.slot').nth(1).locator('table tr').count(); await page.setInputFiles('#deck-file', path.join(FIX, file)); await page.waitForFunction((b) => document.querySelectorAll('.slot:nth-child(2) table tr').length > b, before, { timeout: 60000 }); return page.locator('.slot').nth(1).locator('table tr').last().textContent(); }

async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(base + '#/home');
  await page.waitForSelector('#book-file', { state: 'attached' });
  check((await page.locator('.hero h1').textContent()) === "Mae's Medical Tome" && (await page.locator('.dropzone').count()) === 2, `${label}: empty library shows two upload slots`);
  check((await page.locator('.hero a.primary').count()) === 0, `${label}: no reading link before a book is loaded`);
  await shot(page, `${label}-library-empty.png`);

  // --- PDF book: structure detected from heading sizes
  const t1 = await loadBook(page, 'book.pdf');
  check(/3 chapters, 9 sections/.test(t1), `${label}: PDF book → ${t1}`);
  check(/heading sizes/i.test(await page.locator('.slot').first().textContent()), `${label}: PDF structure mode shown (headings)`);
  await page.goto(base + '#/read');
  await page.waitForSelector('article.book');
  check((await page.locator('aside li.chapter').count()) === 3, `${label}: reader lists 3 chapters`);
  check(/first heart sound/i.test(await page.locator('article.book').textContent()), `${label}: reader shows the PDF text`);
  await page.goto(base + '#/home'); await page.waitForSelector('#deck-file', { state: 'attached' });

  // --- PDF deck: auto-linked
  const d1 = await loadDeck(page, 'deck.pdf');
  const linked = Number((/(\d+) linked/.exec(d1) || [])[1]);
  check(/6 slides/.test(d1) && linked >= 4, `${label}: PDF deck → ${d1.trim()}`);
  await shot(page, `${label}-library.png`);
  await noOverflow(page, `${label} library`);

  // --- slides: practice first, book excerpts after an attempt
  const deckHref = await page.locator('.slot').nth(1).locator('table a').first().getAttribute('href');
  await page.goto(base + deckHref.replace(/^#/, '#'));
  await page.waitForSelector('.panel .practice textarea.answer');
  await page.waitForFunction(() => { const c = document.querySelector('.stage canvas'); return c && c.width > 50; });
  check(true, `${label}: slide 1 rendered from the PDF`);
  check(/Heart sounds/.test(await page.locator('.panel strong').first().textContent()), `${label}: slide title read from the PDF`);
  await page.locator('.tabs button', { hasText: 'From the book' }).click();
  check((await page.locator('.explain.gated').count()) === 1, `${label}: book excerpts gated before an attempt`);
  await page.locator('.tabs button', { hasText: 'Practice' }).click();
  await page.locator('.practice textarea.answer').fill('heart sounds are made by the heart beating and stuff');
  await page.locator('.practice button', { hasText: 'Check my answer' }).click();
  await page.waitForSelector('.practice .feedback .notice');
  const fb = await page.locator('.practice .feedback').textContent();
  check(/Starting|Developing/.test(fb) && /terminology used/i.test(fb) && /capital letter/.test(fb), `${label}: coaching feedback on a weak answer (terminology + writing)`);
  await page.locator('.tabs button', { hasText: 'From the book' }).click();
  await page.waitForSelector('.panel .linked-sec');
  check((await page.locator('.explain.gated').count()) === 0 && (await page.locator('.panel .explain mark').count()) >= 3, `${label}: book sentences shown with highlighted shared terms after an attempt`);
  check(/Heart sounds/.test(await page.locator('.panel .linked-sec h4').first().textContent()), `${label}: slide "Heart sounds" linked to the "Heart sounds" section`);
  await shot(page, `${label}-slides.png`);
  await noOverflow(page, `${label} slides`);
  await page.locator('.tabs button', { hasText: 'Notes' }).click();
  await page.locator('.panel textarea').fill('S3 = volume overload in adults');
  await page.locator('.stage .counter').click();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => location.hash.endsWith('/2'));
  check(true, `${label}: arrow key advances`);

  // --- PPTX deck renders as text slides
  await page.goto(base + '#/home'); await page.waitForSelector('#deck-file', { state: 'attached' });
  const d2 = await loadDeck(page, 'deck.pptx');
  check(/6 slides/.test(d2), `${label}: PPTX deck → ${d2.trim()}`);
  const pHref = await page.locator('.slot').nth(1).locator('table a').last().getAttribute('href');
  await page.goto(base + pHref);
  await page.waitForSelector('.stage .fallback.text');
  check(/Heart sounds/.test(await page.locator('.stage .fallback.text h2').textContent()) && (await page.locator('.stage .fallback.text li').count()) >= 3, `${label}: PPTX slide text rendered`);

  // --- files: EPUB generated on the device
  await page.goto(base + '#/downloads');
  await page.waitForSelector('table.list');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('tr', { has: page.locator('b', { hasText: /^EPUB$/ }) }).locator('button').click()]);
  const epubPath = await dl.path();
  check(/\.epub$/.test(dl.suggestedFilename()) && (await fs.stat(epubPath)).size > 1500, `${label}: EPUB export downloaded (${dl.suggestedFilename()})`);
  const z = await JSZip.loadAsync(await fs.readFile(epubPath));
  check(!!z.file('OEBPS/content.opf') && Object.keys(z.files).filter((f) => /ch-\d+\.xhtml/.test(f)).length === 3, `${label}: EPUB has 3 chapter files`);
  await shot(page, `${label}-files.png`);

  // --- sync to a second device that loaded the same files
  await page.goto(base + '#/sync');
  await page.locator('button', { hasText: 'Create sync code' }).click();
  const code = await page.locator('textarea.code[readonly]').inputValue();
  check(/^MMT1\./.test(code), `${label}: sync code created (${code.length} chars)`);
  const ctx2 = await browser.newContext({ viewport });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
  await p2.goto(base + '#/home'); await p2.waitForSelector('#book-file', { state: 'attached' });
  await loadBook(p2, 'book.pdf'); await loadDeck(p2, 'deck.pdf');
  await p2.goto(base + '#/sync');
  await p2.locator('textarea.code:not([readonly])').fill(code);
  await p2.locator('button', { hasText: 'Preview changes' }).click();
  await p2.waitForSelector('.diff');
  const warns = await p2.locator('.notice.warn').allTextContents();
  check(!warns.some((w) => /different book/.test(w)) && warns.some((w) => /1 deck/.test(w)), `${label}: same book → no mismatch warning; missing PPTX deck noted (${warns.length} notice)`);
  await p2.locator('button', { hasText: 'Merge into this device' }).click();
  await p2.waitForSelector('.toast');
  await p2.goto(base + deckHref);
  await p2.locator('.tabs button', { hasText: 'Notes' }).click();
  check((await p2.locator('.panel textarea').inputValue()) === 'S3 = volume overload in adults', `${label}: note arrived on the second device for the same slide`);
  await ctx2.close();

  // --- replace the book with EPUB, DOCX, HTML; structure switch on PDF
  await page.goto(base + '#/home'); await page.waitForSelector('#book-file', { state: 'attached' });
  for (const f of ['book.epub', 'book.docx', 'book.html']) { const t = await loadBook(page, f); check(/3 chapters, 9 sections/.test(t) || (f === 'book.epub' && /3 chapters/.test(t)), `${label}: ${f} → ${t}`); }
  const t5 = await loadBook(page, 'book.pdf');
  check(/3 chapters/.test(t5), `${label}: PDF reloaded`);
  await page.locator('.slot').first().locator('select').selectOption('pages');
  await page.waitForFunction(() => /page groups/i.test(document.querySelector('.slot')?.textContent || ''), null, { timeout: 20000 });
  check(!/3 chapters, 9 sections/.test(await bookChip(page).textContent()), `${label}: structure switched to page groups (${(await bookChip(page).textContent()).trim()})`);

  // --- teach it back in the reader
  await page.locator('.slot').first().locator('select').selectOption('headings');
  await page.waitForFunction(() => /3 chapters, 9 sections/.test(document.querySelector('.slot .chip.ok')?.textContent || ''), null, { timeout: 20000 });
  await page.goto(base + '#/read');
  await page.waitForSelector('article.book');
  await page.locator('article.book section').nth(1).locator('button', { hasText: 'Teach it back' }).click();
  await page.locator('article.book section').nth(1).locator('.practice textarea').fill('The first heart sound comes from closure of the mitral and tricuspid valves at the start of systole, and the second from closure of the aortic and pulmonary valves at the start of diastole, because valves make a sound when they shut.');
  await page.locator('article.book section').nth(1).locator('.practice button', { hasText: 'Check my answer' }).click();
  await page.waitForSelector('article.book section:nth-of-type(2) .practice .feedback .notice, article.book .practice .feedback .notice');
  const tb = await page.locator('article.book .practice .feedback').textContent();
  check(/terminology used: [3-9]|terminology used: 1\d/i.test(tb), `${label}: teach-it-back scores against the detected section (${(tb.match(/terminology used: \d+ of \d+/i) || [''])[0]})`);
  await shot(page, `${label}-reader.png`);
  await noOverflow(page, `${label} reader`);

  // --- updates: same version → "latest"; newer version.json → banner + Update button
  await page.goto(base + '#/settings');
  await page.waitForSelector('h2:has-text("Updates")');
  check(/This version: 0\.1\.0/.test(await page.locator('.card', { hasText: 'Updates' }).textContent()), `${label}: settings shows the running build`);
  await page.locator('button', { hasText: 'Check for updates' }).click();
  await page.waitForFunction(() => /latest version/.test(document.querySelector('.card h2')?.closest('main')?.textContent || ''));
  check(true, `${label}: check reports latest version when server matches`);
  const vpath = path.join(DIST, 'version.json');
  const original = await fs.readFile(vpath, 'utf8');
  await fs.writeFile(vpath, JSON.stringify({ ...JSON.parse(original), sha: 'abc1234', fullSha: 'abc1234abc1234', builtAt: new Date(Date.now() + 60000).toISOString(), buildNumber: 999 }));
  await page.locator('button', { hasText: 'Check for updates' }).click();
  await page.waitForSelector('#update-banner .update-banner');
  check(/abc1234/.test(await page.locator('#update-banner').textContent()) && (await page.locator('#update-banner button', { hasText: 'Update now' }).count()) === 1, `${label}: newer version → banner with "Update now"`);
  check((await page.locator('.card', { hasText: 'Updates' }).locator('button', { hasText: 'Update now' }).count()) === 1, `${label}: settings offers "Update now"`);
  await shot(page, `${label}-update.png`);
  await fs.writeFile(vpath, original);

  const swOk = await page.evaluate(async () => { const r = await navigator.serviceWorker?.ready; return !!r?.active; });
  check(swOk, `${label}: service worker active`);
  const realErrors = errors.filter((e) => !/favicon/.test(e));
  check(realErrors.length === 0, `${label}: no console/page errors${realErrors.length ? ': ' + realErrors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

try {
  await run('desktop', { width: 1280, height: 800 });
  await run('phone', { width: 390, height: 844 });
} catch (e) { console.error('FAIL', e); failures++; }
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
