// End-to-end smoke test of the built app (dist/) in headless Chromium.
// Usage: npm run build && node scripts/smoke.mjs [--shots DIR]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.zip': 'application/zip', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.md': 'text/markdown' };

// Serve dist/ under the same sub-path the app was built for (VITE_BASE), as GitHub Pages does.
const BASE_PATH = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(BASE_PATH)) { res.writeHead(404); return res.end('outside base'); }
  p = '/' + p.slice(BASE_PATH.length);
  if (p === '/') p = '/index.html';
  try {
    const data = await fs.readFile(path.join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;
console.log(`serving dist/ at ${base}`);

const { chromium } = await import('playwright');
const exe = process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined;
const browser = await chromium.launch(exe && (await fs.access(exe).then(() => true, () => false)) ? { executablePath: exe } : {});
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const noOverflow = async (page, label) => {
  const r = await page.evaluate(() => { const d = document.documentElement; const wide = []; for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (b.right > d.clientWidth + 1 || b.left < -1) wide.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)}`); } return { over: d.scrollWidth > d.clientWidth, x: window.scrollX, wide: wide.slice(0, 6) }; });
  check(!r.over && r.x === 0, `${label}: no horizontal overflow${r.over || r.x ? ' (' + r.wide.join(' | ') + ')' : ''}`);
};
const shot = async (page, name) => { if (shotsDir) { await fs.mkdir(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, name), fullPage: false }); } };

async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(base + '#/home');
  await page.waitForSelector('.hero');
  check(await page.locator('.hero h1').textContent() === "Mae's Medical Tome", `${label}: home renders`);
  await shot(page, `${label}-home.png`);

  await page.goto(base + '#/read/cardiac-cycle/heart-sounds');
  await page.waitForSelector('article.book');
  check((await page.locator('article.book section').count()) === 6, `${label}: chapter renders all sections`);
  await page.locator('#sec-heart-sounds [data-toggle^="studied"]').click();
  check(await page.locator('#sec-heart-sounds [data-toggle^="studied"]').evaluate((b) => b.classList.contains('on')), `${label}: mark studied toggles`);
  check((await page.locator('#sec-heart-sounds .chip.accent').count()) >= 1, `${label}: section shows the slides that cover it`);
  await noOverflow(page, `${label} reader`);
  await shot(page, `${label}-reader.png`);

  await page.goto(base + '#/slides/cv-physiology/6');
  await page.waitForSelector('.panel .linked-sec');
  await page.waitForFunction(() => { const c = document.querySelector('.stage canvas'); return c && c.width > 50; });
  check(true, `${label}: slide 6 PDF page rendered to canvas`);
  check((await page.locator('.explain').count()) === 1, `${label}: explanation shown for slide 6`);
  check((await page.locator('.linked-sec h4').first().textContent()) === 'Heart sounds', `${label}: slide 6 links to "Heart sounds"`);
  await noOverflow(page, `${label} slides`);
  await shot(page, `${label}-slides.png`);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => location.hash.endsWith('/7'));
  check(true, `${label}: arrow key advances to slide 7`);
  await page.locator('.tabs button', { hasText: 'Find in book' }).click();
  await page.waitForSelector('.panel .linked-sec');
  const first = await page.locator('.panel .linked-sec h4').first().textContent();
  check(/mean pressure|haemodynamic/i.test(first), `${label}: suggestions for slide 7 lead with a blood-pressure section (${first})`);
  await page.locator('.panel .linked-sec button.primary').first().click();
  check((await page.locator('.panel .chip.ok').count()) >= 1, `${label}: user link added`);
  await page.locator('.tabs button', { hasText: 'Notes' }).click();
  await page.locator('.panel textarea').fill('MAP = DBP + PP/3');
  await shot(page, `${label}-suggest.png`);

  await page.goto(base + '#/downloads');
  await page.waitForSelector('table.list');
  check((await page.locator('table.list a[download]').count()) >= 8, `${label}: downloads lists book + deck formats`);
  for (const href of await page.locator('table.list a[download]').evaluateAll((as) => as.map((a) => a.href))) {
    const r = await fetch(href, { method: 'HEAD' }).catch(() => ({ ok: false }));
    const r2 = r.ok ? r : await fetch(href).catch(() => ({ ok: false }));
    check(r2.ok, `${label}: download reachable ${new URL(href).pathname}`);
  }
  await page.locator('table.list button', { hasText: 'Save offline' }).first().click();
  await page.waitForSelector('.chip.ok');
  check(true, `${label}: save offline caches a file`);
  await noOverflow(page, `${label} downloads`);
  check((await page.locator('.chip.ok').first().textContent()).trim() === 'offline', `${label}: offline chip label`);
  await shot(page, `${label}-downloads.png`);

  await page.goto(base + '#/sync');
  await page.locator('button', { hasText: 'Create sync code' }).click();
  const code = await page.locator('textarea.code[readonly]').inputValue();
  check(/^MMT1\.[0-9a-f]{8}\.[A-Za-z0-9\-_]+\.$/.test(code), `${label}: sync code generated (${code.length} chars)`);
  await page.locator('button', { hasText: 'Show QR' }).click();
  await page.waitForSelector('.qr-wrap canvas');
  check(true, `${label}: QR rendered`);
  await noOverflow(page, `${label} sync`);
  await shot(page, `${label}-sync.png`);

  // import into a fresh profile and verify the merge
  const ctx2 = await browser.newContext({ viewport });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('p2: ' + e.message));
  await p2.goto(base + '#/sync');
  await p2.locator('textarea.code:not([readonly])').fill(`Hi Mae,\n\n${code.replace(/(.{60})/g, '$1\n')}\n\nSent from my phone`);
  await p2.locator('button', { hasText: 'Preview changes' }).click();
  await p2.waitForSelector('.diff');
  const added = await p2.locator('.diff div b').first().textContent();
  check(Number(added) >= 5, `${label}: import preview shows ${added} new items`);
  await p2.locator('button', { hasText: 'Merge into this device' }).click();
  await p2.waitForSelector('.toast');
  await p2.goto(base + '#/slides/cv-physiology/7');
  await p2.locator('.tabs button', { hasText: 'Notes' }).click();
  check((await p2.locator('.panel textarea').inputValue()) === 'MAP = DBP + PP/3', `${label}: note arrived on the second device`);
  await p2.goto(base + '#/read/cardiac-cycle/heart-sounds');
  check(await p2.locator('#sec-heart-sounds [data-toggle^="studied"]').evaluate((b) => b.classList.contains('on')), `${label}: studied flag arrived on the second device`);
  await ctx2.close();

  await page.goto(base + '#/settings');
  await page.waitForSelector('h1');
  await shot(page, `${label}-settings.png`);

  // service worker registered?
  await page.goto(base + '#/home');
  await page.waitForSelector('.hero');
  const swOk = await page.evaluate(async () => { const r = await navigator.serviceWorker?.ready; return !!r?.active; });
  check(swOk, `${label}: service worker active`);

  const realErrors = errors.filter((e) => !/favicon/.test(e));
  check(realErrors.length === 0, `${label}: no console/page errors${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`);
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
