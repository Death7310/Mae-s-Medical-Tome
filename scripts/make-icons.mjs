// Generates public/icons/*.png from icon.svg using the bundled Chromium (run once; PNGs are committed).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = await fs.readFile(path.join(dir, 'icon.svg'), 'utf8');
const { chromium } = await import('playwright');
const exe = process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined;
const browser = await chromium.launch(exe && (await fs.access(exe).then(() => true, () => false)) ? { executablePath: exe } : {});
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 0.1]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<body style="margin:0;background:#0b3d5c;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg', '<svg style="width:100%;height:100%"')}</div></body>`);
  await page.screenshot({ path: path.join(dir, name), clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
