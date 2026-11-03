/** Thin wrapper around pdf.js: open once, render pages into a canvas, extract text. */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const docs = new Map();

export async function openPdf(key, source) {
  if (docs.has(key)) return docs.get(key);
  const p = pdfjsLib.getDocument(typeof source === 'string' ? { url: source } : { data: source }).promise;
  docs.set(key, p);
  p.catch(() => docs.delete(key));
  return p;
}
export function closePdf(key) { docs.delete(key); }

let renderTask = null;
export async function renderPage(doc, pageNumber, canvas, maxWidth, maxHeight) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, (maxHeight || Infinity) / base.height) || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext('2d');
  if (renderTask) { try { renderTask.cancel(); } catch {} }
  renderTask = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
  try { await renderTask.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') throw e; }
  renderTask = null;
}

export async function extractTextPerPage(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = '';
    for (const it of tc.items) text += it.str + (it.hasEOL ? '\n' : ' ');
    pages.push(text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
  }
  return pages;
}
