/** Library: the two slots (book, slides) plus progress at a glance. */
import { h, icon, toast, fmtBytes, fmtDate } from '../lib/ui.js';
import { content, allDecks, rebuild, hasBook } from '../lib/content.js';
import { library, setBookFromFile, restructureBook, removeBook, addDecksFromFile, removeDeck } from '../lib/library.js';
import { BOOK_FORMATS, DECK_FORMATS } from '../lib/parsers/index.js';
import { getState, countOn, onChange } from '../lib/store.js';
import { app } from '../main.js';
import { isNative } from '../lib/native.js';

const MODE_LABEL = { outline: 'From the PDF bookmarks', headings: 'Detected from heading sizes', pages: 'Fixed page groups' };
const KIND_LABEL = { pdf: 'PDF', epub: 'EPUB', docx: 'Word', html: 'HTML', md: 'Markdown', txt: 'Text', zip: 'ZIP', pptx: 'PowerPoint' };

export async function render(root) {
  let busy = null; // { label, pct }
  const draw = () => {
    const st = getState();
    const book = content.book;
    const bookSlot = slotCard({
      id: 'book-file', title: 'Your book', accept: BOOK_FORMATS.map((e) => '.' + e).join(','), multiple: false,
      hint: 'One file in any of these formats: PDF, EPUB, Word (.docx), HTML, Markdown, or a ZIP containing one of them. The app reads it, detects chapters and sections, and indexes every section.',
      current: library.book ? bookSummary() : null,
      onFiles: async (files) => { await loadBook(files[0]); },
    });
    const deckSlot = slotCard({
      id: 'deck-file', title: 'Your slides', accept: DECK_FORMATS.map((e) => '.' + e).join(','), multiple: true,
      hint: 'Lecture decks as PDF or PowerPoint (.pptx), or Markdown/HTML, or a ZIP of several. Each slide is linked to the book sections its wording matches.',
      current: library.decks.length ? deckList() : null,
      onFiles: async (files) => { for (const f of files) await loadDeck(f); },
    });
    const busyBar = busy ? h('div', { class: 'card busy' }, h('div', { class: 'row' }, h('b', {}, busy.label), h('span', { class: 'muted small' }, busy.pct != null ? `${busy.pct}%` : '')), h('div', { class: 'progress', style: { marginTop: '.4rem' } }, h('span', { style: { width: `${busy.pct ?? 100}%` } }))) : null;

    const parts = [];
    if (!book) {
      parts.push(h('div', { class: 'hero' }, h('h1', {}, "Mae's Medical Tome"), h('p', {}, 'Load your book and your lecture slides. The app reads the book, links every slide to the passages it comes from, and coaches you to explain each one in your own words.'), installButton()));
    } else {
      const totalSections = book.chapters.reduce((a, c) => a + c.sections.length, 0);
      const last = st.progress.lastBook, lastSlides = st.progress.lastSlides;
      const lastDeck = lastSlides && allDecks().find((d) => d.id === lastSlides.deck);
      parts.push(h('div', { class: 'hero' }, h('h1', {}, book.title), h('p', {}, `${book.chapters.length} chapters · ${totalSections} sections · ${allDecks().length} deck${allDecks().length === 1 ? '' : 's'}`),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: last ? `#/read/${last.chapter}/${last.section}` : '#/read' }, icon('book'), last ? 'Continue reading' : 'Start reading'),
          allDecks().length ? h('a', { class: 'btn', href: lastDeck ? `#/slides/${lastSlides.deck}/${lastSlides.slide}` : '#/slides' }, icon('slides'), lastDeck ? `Continue slides (${lastSlides.slide})` : 'Open slides') : null,
          installButton())));
      parts.push(h('div', { class: 'card' }, h('div', { class: 'row', style: { gap: '2rem' } },
        h('div', { class: 'stat' }, h('b', {}, `${countOn('studied', 'book:')}/${totalSections}`), h('span', { class: 'muted small' }, 'sections studied')),
        h('div', { class: 'stat' }, h('b', {}, String(countOn('studied', 'slide:'))), h('span', { class: 'muted small' }, 'slides studied')),
        h('div', { class: 'stat' }, h('b', {}, String(Object.values(st.practice || {}).filter((p) => p.mastered).length)), h('span', { class: 'muted small' }, 'explained in your own words')),
        h('div', { class: 'stat' }, h('b', {}, String(Object.values(st.notes).filter((n) => n.text?.trim()).length)), h('span', { class: 'muted small' }, 'notes')))));
    }
    parts.push(busyBar, h('div', { class: 'grid slots' }, bookSlot, deckSlot));
    if (book) parts.push(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h2', {}, 'Chapters'), h('table', { class: 'list' }, ...book.chapters.map((c) => {
      const done = c.sections.filter((s) => st.studied[`book:${c.id}#${s.id}`]?.on).length;
      return h('tr', {}, h('td', { style: { width: '2.5rem' }, class: 'muted' }, String(c.number)), h('td', {}, h('a', { href: `#/read/${c.id}` }, c.title), h('div', { class: 'muted small' }, `${c.sections.length} sections · ${c.words} words`), h('div', { class: 'progress', style: { marginTop: '.3rem', maxWidth: '14rem' } }, h('span', { style: { width: `${(100 * done) / Math.max(c.sections.length, 1)}%` } }))), h('td', { class: 'small muted', style: { textAlign: 'right', whiteSpace: 'nowrap' } }, `${done}/${c.sections.length}`));
    }))));
    parts.push(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h2', {}, 'How it works'), h('ul', { class: 'small' },
      h('li', {}, h('b', {}, 'Book'), ': read by section, mark studied, keep notes, and "teach it back" in writing.'),
      h('li', {}, h('b', {}, 'Slides'), ': each slide opens on a practice prompt. After you have tried, "From the book" shows the sentences of your book that match the slide, with the shared terms highlighted, and links to the full sections.'),
      h('li', {}, h('b', {}, 'Files'), ': the book you loaded, exported as HTML, Markdown, EPUB and ZIP, plus the originals.'),
      h('li', {}, h('b', {}, 'Sync'), ': notes, answers and progress move between phone and computer as a code. Load the same files on both devices.'))));
    root.replaceChildren(...parts.filter(Boolean));
  };

  function bookSummary() {
    const b = library.book;
    return h('div', {},
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('b', {}, b.title), h('div', { class: 'muted small' }, `${b.name} · ${KIND_LABEL[b.inner || b.kind] || b.kind} · ${fmtBytes(b.size)} · added ${fmtDate(b.addedAt)}`)), h('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Remove the book from this device? Notes and answers are kept and reattach if you load the same file again.')) { await removeBook(); rebuild(); draw(); } } }, icon('trash'), 'Remove')),
      h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('span', { class: 'chip ok' }, icon('check'), `${b.chapters} chapters, ${b.sections} sections`), b.pageCount ? h('span', { class: 'chip' }, `${b.pageCount} pages`) : null),
      b.available?.length > 1 ? h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('label', { class: 'small' }, 'Structure'), h('select', { style: { width: 'auto' }, onchange: async (e) => { busy = { label: 'Re-structuring the book…' }; draw(); try { await restructureBook(e.target.value); rebuild(); toast(`Structure: ${MODE_LABEL[e.target.value]}`, 'ok'); } catch (err) { toast(err.message, 'error'); } busy = null; draw(); } }, ...b.available.map((m) => h('option', { value: m, selected: m === b.mode }, MODE_LABEL[m]))), h('span', { class: 'muted small' }, 'If chapters look wrong, try another structure.')) : h('div', { class: 'muted small', style: { marginTop: '.4rem' } }, b.mode ? MODE_LABEL[b.mode] : 'Structure taken from the document headings.'));
  }
  function deckList() {
    return h('table', { class: 'list' }, ...allDecks().map((d) => {
      const linked = d.slides.filter((s) => s.sections?.length || getState().userLinks[`slide:${d.id}#${s.number}`]?.sections?.length).length;
      return h('tr', {}, h('td', {}, h('a', { href: `#/slides/${d.id}/1` }, d.title), h('div', { class: 'muted small' }, `${KIND_LABEL[d.kind] || d.kind} · ${d.slides.length} slides · ${hasBook() ? `${linked} linked to the book` : 'load a book to link'}${d.textSlides < d.slides.length ? ` · ${d.slides.length - d.textSlides} slides have no readable text` : ''}`)),
        h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm danger', onclick: async () => { if (confirm(`Remove "${d.title}"? Notes for it are kept.`)) { await removeDeck(d.id); rebuild(); draw(); } } }, icon('trash'))));
    }));
  }

  async function loadBook(file) {
    if (!file) return;
    busy = { label: `Reading ${file.name}…`, pct: 0 }; draw();
    try {
      const t0 = Date.now();
      const meta = await setBookFromFile(file, { onProgress: async (p, n) => { const pct = Math.round((100 * p) / n); if (pct !== busy.pct) { busy.pct = pct; busy.label = `Reading ${file.name}: page ${p} of ${n}`; draw(); await new Promise((r) => setTimeout(r)); } } });
      rebuild();
      toast(`Loaded "${meta.title}": ${meta.chapters} chapters, ${meta.sections} sections (${((Date.now() - t0) / 1000).toFixed(0)}s).`, 'ok', 5000);
    } catch (e) { console.error(e); toast(`Could not load the book: ${e.message}`, 'error', 7000); }
    busy = null; draw();
  }
  async function loadDeck(file) {
    busy = { label: `Reading ${file.name}…`, pct: 0 }; draw();
    try {
      const added = await addDecksFromFile(file, { onProgress: async (p, n) => { const pct = Math.round((100 * p) / n); if (pct !== busy.pct) { busy.pct = pct; draw(); await new Promise((r) => setTimeout(r)); } } });
      rebuild();
      if (!added.length) toast('That deck is already loaded.', 'info');
      else for (const d of added) { const deck = allDecks().find((x) => x.id === d.id); const linked = deck.slides.filter((s) => s.sections.length).length; toast(`Added "${d.name}": ${d.slides} slides${hasBook() ? `, ${linked} linked to the book` : ''}.`, 'ok', 5000); }
    } catch (e) { console.error(e); toast(`Could not load the slides: ${e.message}`, 'error', 7000); }
    busy = null; draw();
  }

  draw();
  const off = onChange(draw);
  const onInstallable = () => draw();
  window.addEventListener('mmt:installable', onInstallable);
  return () => { off(); window.removeEventListener('mmt:installable', onInstallable); };
}

function slotCard({ id, title, accept, multiple, hint, current, onFiles }) {
  const input = h('input', { type: 'file', id, accept, multiple: multiple || null, style: { display: 'none' }, onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) onFiles(files); } });
  const zone = h('div', { class: `dropzone${current ? ' has' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${title}: choose a file`,
    onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); const files = [...e.dataTransfer.files]; if (files.length) onFiles(multiple ? files : [files[0]]); } },
    icon('download', 'big'), h('div', {}, h('b', {}, current ? (multiple ? 'Add more slides' : 'Replace the book') : `Choose ${multiple ? 'files' : 'a file'}`), h('div', { class: 'muted small' }, 'or drop it here')));
  return h('div', { class: 'card slot' }, h('h2', {}, title), current, h('p', { class: 'muted small' }, hint), zone, input);
}

function installButton() {
  if (isNative() || matchMedia('(display-mode: standalone)').matches) return null;
  if (app.installPrompt) return h('button', { class: 'btn', onclick: async () => { app.installPrompt.prompt(); await app.installPrompt.userChoice; app.installPrompt = null; } }, icon('download'), 'Install app');
  return h('a', { class: 'btn', href: '#/settings' }, icon('download'), 'Install');
}
