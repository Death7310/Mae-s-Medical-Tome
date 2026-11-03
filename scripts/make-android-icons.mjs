// Renders the app icon into the Android mipmap sizes and a splash image, using the bundled Chromium.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const svg = await fs.readFile(path.join(ROOT, 'public', 'icons', 'icon.svg'), 'utf8');
const { chromium } = await import('playwright');
const exe = process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined;
const browser = await chromium.launch(exe && (await fs.access(exe).then(() => true, () => false)) ? { executablePath: exe } : {});
const page = await browser.newPage();
const render = async (file, size, inner, bg, radius) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px"><div style="width:${inner}px;height:${inner}px;border-radius:${radius}px;overflow:hidden">${svg.replace('<svg', '<svg style="width:100%;height:100%;display:block"')}</div></body>`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size }, omitBackground: bg === 'transparent' });
};
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, m] of Object.entries(densities)) {
  const dir = path.join(RES, `mipmap-${d}`);
  await render(path.join(dir, 'ic_launcher.png'), 48 * m, 48 * m, '#0b3d5c', 0);
  await render(path.join(dir, 'ic_launcher_round.png'), 48 * m, 48 * m, '#0b3d5c', 0);
  // adaptive foreground: 108dp canvas, artwork inside the 72dp safe zone
  await render(path.join(dir, 'ic_launcher_foreground.png'), 108 * m, 66 * m, 'transparent', 0);
}
// splash: centred icon on brand colour, portrait and landscape at several sizes
for (const [name, w, h] of [['drawable', 480, 320], ['drawable-port-mdpi', 320, 480], ['drawable-port-hdpi', 480, 800], ['drawable-port-xhdpi', 720, 1280], ['drawable-port-xxhdpi', 960, 1600], ['drawable-port-xxxhdpi', 1280, 1920], ['drawable-land-mdpi', 480, 320], ['drawable-land-hdpi', 800, 480], ['drawable-land-xhdpi', 1280, 720], ['drawable-land-xxhdpi', 1600, 960], ['drawable-land-xxxhdpi', 1920, 1280]]) {
  await page.setViewportSize({ width: w, height: h });
  const s = Math.round(Math.min(w, h) * 0.28);
  await page.setContent(`<body style="margin:0;background:#0b3d5c;display:flex;align-items:center;justify-content:center;width:${w}px;height:${h}px"><div style="width:${s}px;height:${s}px">${svg.replace('<svg', '<svg style="width:100%;height:100%;display:block"')}</div></body>`);
  await page.screenshot({ path: path.join(RES, name, 'splash.png'), clip: { x: 0, y: 0, width: w, height: h } });
}
await browser.close();
console.log('android icons and splash written');
