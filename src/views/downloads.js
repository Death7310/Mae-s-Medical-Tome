/** Files: the originals you loaded plus the book exported in every format, generated on the device. */
import { h, icon, toast, fmtBytes, downloadBlob } from '../lib/ui.js';
import { content, allDecks } from '../lib/content.js';
import { library, bookBlob, deckBlob, bookToHtml, bookToMarkdown, bookToEpub, deckToMarkdown } from '../lib/library.js';
import { isNative, saveAndShare } from '../lib/native.js';

export async function render(root) {
  const native = isNative();
  const deliver = async (blob, filename, label) => { if (native) await saveAndShare(blob, filename, label); else downloadBlob(blob, filename); };
  const row = (label, sub, make, filename) => {
    const btn = h('button', { class: 'btn sm primary', onclick: async () => { btn.disabled = true; try { const blob = await make(); await deliver(blob, filename, label); } catch (e) { if (!/cancel/i.test(e.message)) toast(`Failed: ${e.message}`, 'error'); } btn.disabled = false; } }, icon('download'), native ? 'Save / share' : 'Download');
    return h('tr', {}, h('td', {}, h('b', {}, label), h('div', { class: 'muted small' }, sub)), h('td', { style: { textAlign: 'right' } }, btn));
  };
  const parts = [h('h1', {}, 'Files')];
  if (!content.books.length && !allDecks().length) { parts.push(h('div', { class: 'card' }, h('p', {}, 'Nothing loaded yet. ', h('a', { href: '#/home' }, 'Load a book and slides in the Library'), '.'))); root.replaceChildren(...parts); return; }
  parts.push(h('div', { class: 'card' }, h('p', { class: 'small' }, 'Everything here is generated on this device from the files you loaded; nothing is uploaded anywhere. ', native ? 'Save / share opens the Android share sheet.' : 'Downloads go to your Downloads folder.')));
  for (const b of content.books) {
    const book = b.data;
    const base = b.name.replace(/\.[^.]+$/, '');
    const rows = [row(`Original (${(b.inner || b.kind).toUpperCase()})`, `${b.name} · ${fmtBytes(b.size)}`, () => bookBlob(b.id), b.name)];
    rows.push(row('EPUB', 'Reflowable e-book of the detected chapters, for phone reading apps and e-readers', () => bookToEpub(book, b.id), `${base}.epub`));
    rows.push(row('HTML', 'Single searchable page with a table of contents', () => new Blob([bookToHtml(book)], { type: 'text/html' }), `${base}.html`));
    rows.push(row('Markdown', 'Plain text with chapter and section headings', () => new Blob([bookToMarkdown(book)], { type: 'text/markdown' }), `${base}.md`));
    rows.push(row('ZIP (everything)', 'Original + EPUB + HTML + Markdown in one archive', async () => { const { default: JSZip } = await import('jszip'); const z = new JSZip(); z.file(b.name, await bookBlob(b.id)); z.file(`${base}.epub`, await bookToEpub(book, b.id)); z.file(`${base}.html`, bookToHtml(book)); z.file(`${base}.md`, bookToMarkdown(book)); return z.generateAsync({ type: 'blob', compression: 'DEFLATE' }); }, `${base}.zip`));
    const printBtn = h('button', { class: 'btn sm', onclick: () => { const w = window.open('', '_blank'); if (!w) { toast('Pop-up blocked. Allow pop-ups for this site to print.', 'error'); return; } w.document.write(bookToHtml(book)); w.document.close(); setTimeout(() => w.print(), 400); } }, icon('book'), 'Print / Save as PDF');
    parts.push(h('div', { class: 'card' }, h('h2', {}, book.title), h('div', { class: 'muted small', style: { marginTop: '-.5rem', marginBottom: '.5rem' } }, `${book.chapters.length} chapters · ${b.sections} sections`), h('table', { class: 'list' }, ...rows), (b.inner || b.kind) !== 'pdf' ? h('div', { class: 'row', style: { marginTop: '.6rem' } }, printBtn, h('span', { class: 'muted small' }, 'Opens the HTML in a print view; choose "Save as PDF" as the printer.')) : null));
  }
  for (const d of allDecks()) {
    const meta = library.decks.find((x) => x.id === d.id);
    const base = meta.name.replace(/\.[^.]+$/, '');
    parts.push(h('div', { class: 'card' }, h('h2', {}, d.title), h('div', { class: 'muted small', style: { marginTop: '-.5rem', marginBottom: '.5rem' } }, `Slide deck · ${d.slides.length} slides`), h('table', { class: 'list' },
      row(`Original (${meta.kind.toUpperCase()})`, `${meta.name} · ${fmtBytes(meta.size)}`, () => deckBlob(d.id), meta.name),
      row('Slide text (Markdown)', 'The text of every slide, one block per slide', () => new Blob([deckToMarkdown(d)], { type: 'text/markdown' }), `${base}.md`))));
  }
  parts.push(h('div', { class: 'card' }, h('h3', {}, 'Which format when?'), h('ul', { class: 'small' },
    h('li', {}, h('b', {}, 'EPUB'), ': reflowable text for Google Play Books, Huawei Books, Apple Books, Calibre.'),
    h('li', {}, h('b', {}, 'HTML / Markdown'), ': plain, searchable, easy to paste into notes or other tools.'),
    h('li', {}, h('b', {}, 'PDF'), ': the original if you loaded a PDF; otherwise use Print / Save as PDF.'),
    h('li', {}, h('b', {}, 'ZIP'), ': all of the above for backup.'))));
  root.replaceChildren(...parts);
}
