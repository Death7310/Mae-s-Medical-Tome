/** Library: the two slots (book, slides) plus progress at a glance. */
import { h, icon, toast, fmtBytes, fmtDate } from '../lib/ui.js';
import { content, allDecks, rebuild, hasBook, linkableBooks } from '../lib/content.js';
import { library, addBookFromFile, restructureBook, removeBook, moveBook, setBookEnabled, addDecksFromFile, removeDeck, moveDeck } from '../lib/library.js';
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
    const books = content.books;
    const book = books[0];
    const bookSlot = slotCard({
      id: 'book-file', title: books.length > 1 ? 'Your books' : 'Your book', accept: BOOK_FORMATS.map((e) => '.' + e).join(','), multiple: true,
      hint: 'PDF, EPUB, Word (.docx), HTML, Markdown, or a ZIP containing one of them. The app reads each book, detects chapters and sections, and indexes every section. When several books match a slide, the one higher in this list is preferred; use the arrows to set that priority.',
      current: books.length ? bookList() : null,
      onFiles: async (files) => { for (const f of files) await loadBook(f); },
    });
    const deckSlot = slotCard({
      id: 'deck-file', title: 'Your slides', accept: DECK_FORMATS.map((e) => '.' + e).join(','), multiple: true,
      hint: 'Lecture decks as PDF or PowerPoint (.pptx), or Markdown/HTML, or a ZIP of several. Each slide is linked to the book sections its wording matches.',
      current: library.decks.length ? deckList() : null,
      onFiles: async (files) => { for (const f of files) await loadDeck(f); },
    });
    const totalSections = books.reduce((a, b) => a + b.data.chapters.reduce((x, c) => x + c.sections.length, 0), 0);
    const busyBar = busy ? h('div', { class: 'card busy' }, h('div', { class: 'row' }, h('b', {}, busy.label), h('span', { class: 'muted small' }, busy.pct != null ? `${busy.pct}%` : '')), h('div', { class: 'progress', style: { marginTop: '.4rem' } }, h('span', { style: { width: `${busy.pct ?? 100}%` } }))) : null;

    const parts = [];
    if (!book) {
      parts.push(h('div', { class: 'hero' }, h('h1', {}, "Mae's Medical Tome"), h('p', {}, 'Load your book and your lecture slides. The app reads the book, links every slide to the passages it comes from, and coaches you to explain each one in your own words.'), installButton()));
    } else {
      const last = st.progress.lastBook, lastSlides = st.progress.lastSlides;
      const lastDeck = lastSlides && allDecks().find((d) => d.id === lastSlides.deck);
      const lastBookOk = last && books.some((b) => b.id === last.book);
      parts.push(h('div', { class: 'hero' }, h('h1', {}, books.length > 1 ? `${books.length} books` : book.title), h('p', {}, `${books.reduce((a, b) => a + b.data.chapters.length, 0)} chapters · ${totalSections} sections · ${allDecks().length} deck${allDecks().length === 1 ? '' : 's'}`),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: lastBookOk ? `#/read/${last.book}/${last.chapter}/${last.section}` : '#/read' }, icon('book'), lastBookOk ? 'Continue reading' : 'Start reading'),
          allDecks().length ? h('a', { class: 'btn', href: lastDeck ? `#/slides/${lastSlides.deck}/${lastSlides.slide}` : '#/slides' }, icon('slides'), lastDeck ? `Continue slides (${lastSlides.slide})` : 'Open slides') : null,
          installButton())));
      parts.push(h('div', { class: 'card' }, h('div', { class: 'row', style: { gap: '2rem' } },
        h('div', { class: 'stat' }, h('b', {}, `${countOn('studied', 'book:')}/${totalSections}`), h('span', { class: 'muted small' }, 'sections studied')),
        h('div', { class: 'stat' }, h('b', {}, String(countOn('studied', 'slide:'))), h('span', { class: 'muted small' }, 'slides studied')),
        h('div', { class: 'stat' }, h('b', {}, String(Object.values(st.practice || {}).filter((p) => p.mastered).length)), h('span', { class: 'muted small' }, 'explained in your own words')),
        h('div', { class: 'stat' }, h('b', {}, String(Object.values(st.notes).filter((n) => n.text?.trim()).length)), h('span', { class: 'muted small' }, 'notes')))));
    }
    parts.push(busyBar, h('div', { class: 'grid slots' }, bookSlot, deckSlot));
    for (const [bi, b] of books.entries()) parts.push(h('details', { class: 'card', style: { marginTop: '1rem' }, open: bi === 0 || null }, h('summary', {}, h('h2', { style: { display: 'inline', margin: 0 } }, b.title), h('span', { class: 'muted small' }, ` · ${b.data.chapters.length} chapters`)), h('table', { class: 'list', style: { marginTop: '.6rem' } }, ...b.data.chapters.map((c) => {
      const done = c.sections.filter((s) => st.studied[`book:${b.id}/${c.id}#${s.id}`]?.on).length;
      return h('tr', {}, h('td', { style: { width: '2.5rem' }, class: 'muted' }, String(c.number)), h('td', {}, h('a', { href: `#/read/${b.id}/${c.id}` }, c.title), h('div', { class: 'muted small' }, `${c.sections.length} sections · ${c.words} words`), h('div', { class: 'progress', style: { marginTop: '.3rem', maxWidth: '14rem' } }, h('span', { style: { width: `${(100 * done) / Math.max(c.sections.length, 1)}%` } }))), h('td', { class: 'small muted', style: { textAlign: 'right', whiteSpace: 'nowrap' } }, `${done}/${c.sections.length}`));
    }))));
    parts.push(h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h2', {}, 'How it works'), h('ul', { class: 'small' },
      h('li', {}, h('b', {}, 'Books'), ': load as many as you like. Read by section, mark studied, keep notes, and "teach it back" in writing. The order of the list is the priority: when a slide matches several books, the top one wins.'),
      h('li', {}, h('b', {}, 'Slides'), ': each slide opens on a practice prompt. After you have tried, "From the book" shows the sentences of your book that match the slide, with the shared terms highlighted, and links to the full sections.'),
      h('li', {}, h('b', {}, 'Files'), ': the book you loaded, exported as HTML, Markdown, EPUB and ZIP, plus the originals.'),
      h('li', {}, h('b', {}, 'Sync'), ': notes, answers and progress move between phone and computer as a code. Load the same files on both devices.'))));
    root.replaceChildren(...parts.filter(Boolean));
  };

  function bookList() {
    const books = content.books;
    const n = books.length;
    return h('table', { class: 'list books' }, ...books.map((b, i) => {
      const linkRank = linkableBooks().findIndex((x) => x.id === b.id);
      return h('tr', { dataset: { book: b.id } },
        h('td', { class: 'muted', style: { width: '2rem' } }, String(i + 1)),
        h('td', {},
          h('a', { href: `#/read/${b.id}` }, h('b', {}, b.title)),
          h('div', { class: 'muted small' }, `${b.name} · ${KIND_LABEL[b.inner || b.kind] || b.kind} · ${fmtBytes(b.size)} · added ${fmtDate(b.addedAt)}`),
          h('div', { class: 'row', style: { marginTop: '.35rem' } },
            h('span', { class: 'chip ok' }, icon('check'), `${b.chapters} chapters, ${b.sections} sections`),
            b.pageCount ? h('span', { class: 'chip' }, `${b.pageCount} pages`) : null,
            b.enabled === false ? h('span', { class: 'chip warn' }, 'not used for linking') : n > 1 ? h('span', { class: 'chip accent' }, linkRank === 0 ? 'preferred source' : `priority ${linkRank + 1}`) : null),
          b.available?.length > 1 ? h('div', { class: 'row', style: { marginTop: '.4rem' } }, h('label', { class: 'small' }, 'Structure'), h('select', { style: { width: 'auto' }, 'aria-label': 'Book structure', onchange: async (e) => { busy = { label: 'Re-structuring the book…' }; draw(); try { await restructureBook(b.id, e.target.value); rebuild(); toast(`Structure: ${MODE_LABEL[e.target.value]}`, 'ok'); } catch (err) { toast(err.message, 'error'); } busy = null; draw(); } }, ...b.available.map((m) => h('option', { value: m, selected: m === b.mode }, MODE_LABEL[m])))) : h('div', { class: 'muted small', style: { marginTop: '.3rem' } }, b.mode ? MODE_LABEL[b.mode] : 'Structure taken from the document headings.'),
          h('label', { class: 'small row', style: { marginTop: '.4rem', gap: '.35rem' } }, h('input', { type: 'checkbox', checked: b.enabled !== false || null, onchange: async (e) => { await setBookEnabled(b.id, e.target.checked); rebuild(); draw(); } }), 'Use this book when linking slides')),
        h('td', { class: 'actions' },
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
            h('button', { class: 'btn sm icon-only', title: 'Higher priority', 'aria-label': 'Move up', disabled: i === 0, onclick: async () => { await moveBook(b.id, -1); rebuild(); draw(); } }, '▲'),
            h('button', { class: 'btn sm icon-only', title: 'Lower priority', 'aria-label': 'Move down', disabled: i === n - 1, onclick: async () => { await moveBook(b.id, 1); rebuild(); draw(); } }, '▼'),
            h('a', { class: 'btn sm', href: `#/read/${b.id}`, title: 'Open' }, icon('book'), 'Open'),
            h('button', { class: 'btn sm danger', title: 'Remove', onclick: async () => { if (confirm(`Remove "${b.title}" from this device? Notes and answers are kept and reattach if you load the same file again.`)) { await removeBook(b.id); rebuild(); draw(); } } }, icon('trash')))));
    }));
  }
  function deckList() {
    const books = content.books;
    const n = allDecks().length;
    return h('table', { class: 'list decks' }, ...allDecks().map((d, i) => {
      const linked = d.slides.filter((s) => s.sections?.length || getState().userLinks[`slide:${d.id}#${s.number}`]?.sections?.length).length;
      return h('tr', { dataset: { deck: d.id } },
        h('td', {}, h('a', { href: `#/slides/${d.id}/1` }, h('b', {}, d.title)), h('div', { class: 'muted small' }, `${KIND_LABEL[d.kind] || d.kind} · ${d.slides.length} slides · ${hasBook() ? `${linked} linked to the book${books.length > 1 ? 's' : ''}` : 'load a book to link'}${d.textSlides < d.slides.length ? ` · ${d.slides.length - d.textSlides} slides have no readable text` : ''}`)),
        h('td', { class: 'actions' }, h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn sm icon-only', 'aria-label': 'Move up', disabled: i === 0, onclick: async () => { await moveDeck(d.id, -1); rebuild(); draw(); } }, '▲'),
          h('button', { class: 'btn sm icon-only', 'aria-label': 'Move down', disabled: i === n - 1, onclick: async () => { await moveDeck(d.id, 1); rebuild(); draw(); } }, '▼'),
          h('a', { class: 'btn sm', href: `#/slides/${d.id}/1` }, icon('slides'), 'Open'),
          h('button', { class: 'btn sm danger', title: 'Remove', onclick: async () => { if (confirm(`Remove "${d.title}"? Notes for it are kept.`)) { await removeDeck(d.id); rebuild(); draw(); } } }, icon('trash')))));
    }));
  }

  async function loadBook(file) {
    if (!file) return;
    busy = { label: `Reading ${file.name}…`, pct: 0 }; draw();
    try {
      const t0 = Date.now();
      const { book: meta, duplicate } = await addBookFromFile(file, { onProgress: async (p, n) => { const pct = Math.round((100 * p) / n); if (pct !== busy.pct) { busy.pct = pct; busy.label = `Reading ${file.name}: page ${p} of ${n}`; draw(); await new Promise((r) => setTimeout(r)); } } });
      rebuild();
      toast(duplicate ? `"${meta.title}" is already in the library.` : `Added "${meta.title}": ${meta.chapters} chapters, ${meta.sections} sections (${((Date.now() - t0) / 1000).toFixed(0)}s).`, duplicate ? 'info' : 'ok', 5000);
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
    icon('download', 'big'), h('div', {}, h('b', {}, current ? (id === 'book-file' ? 'Add another book' : 'Add more slides') : `Choose ${multiple ? 'files' : 'a file'}`), h('div', { class: 'muted small' }, 'or drop it here')));
  return h('div', { class: 'card slot' }, h('h2', {}, title), current, h('p', { class: 'muted small' }, hint), zone, input);
}

function installButton() {
  if (isNative() || matchMedia('(display-mode: standalone)').matches) return null;
  if (app.installPrompt) return h('button', { class: 'btn', onclick: async () => { app.installPrompt.prompt(); await app.installPrompt.userChoice; app.installPrompt = null; } }, icon('download'), 'Install app');
  return h('a', { class: 'btn', href: '#/settings' }, icon('download'), 'Install');
}
