import { h, icon } from '../lib/ui.js';
import { content, allDecks } from '../lib/content.js';
import { getState, countOn, onChange } from '../lib/store.js';
import { app } from '../main.js';
import { isNative } from '../lib/native.js';

export async function render(root) {
  const draw = () => {
    const st = getState();
    const book = content.book;
    const totalSections = book.chapters.reduce((a, c) => a + c.sections.length, 0);
    const studiedSections = countOn('studied', 'book:');
    const last = st.progress.lastBook;
    const lastSlides = st.progress.lastSlides;
    const lastDeck = lastSlides && allDecks().find((d) => d.id === lastSlides.deck);

    const hero = h('div', { class: 'hero' },
      h('h1', {}, book.title),
      h('p', {}, book.subtitle || 'Read the book, work through the slides, and see how each slide maps back to the text.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: last ? `#/read/${last.chapter}/${last.section}` : '#/read' }, icon('book'), last ? 'Continue reading' : 'Start reading'),
        h('a', { class: 'btn', href: lastDeck ? `#/slides/${lastSlides.deck}/${lastSlides.slide}` : '#/slides' }, icon('slides'), lastDeck ? `Continue slides (${lastSlides.slide})` : 'Open slides'),
        installButton(),
      ));

    const stats = h('div', { class: 'card' }, h('div', { class: 'row', style: { gap: '2rem' } },
      h('div', { class: 'stat' }, h('b', {}, `${studiedSections}/${totalSections}`), h('span', { class: 'muted small' }, 'sections studied')),
      h('div', { class: 'stat' }, h('b', {}, String(countOn('studied', 'slide:'))), h('span', { class: 'muted small' }, 'slides studied')),
      h('div', { class: 'stat' }, h('b', {}, String(Object.values(st.notes).filter((n) => n.text?.trim()).length)), h('span', { class: 'muted small' }, 'notes')),
      h('div', { class: 'stat' }, h('b', {}, String(Object.values(st.practice || {}).filter((p) => p.mastered).length)), h('span', { class: 'muted small' }, 'explained in your own words')),
    ));

    const chapters = h('div', { class: 'card' }, h('h2', {}, 'Chapters'),
      h('table', { class: 'list' }, ...book.chapters.map((c) => {
        const done = c.sections.filter((s) => st.studied[`book:${c.id}#${s.id}`]?.on).length;
        return h('tr', {},
          h('td', { style: { width: '2.5rem' }, class: 'muted' }, String(c.number)),
          h('td', {}, h('a', { href: `#/read/${c.id}` }, c.title), h('div', { class: 'muted small' }, `${c.sections.length} sections · ${c.words} words`), h('div', { class: 'progress', style: { marginTop: '.3rem', maxWidth: '14rem' } }, h('span', { style: { width: `${(100 * done) / c.sections.length}%` } }))),
          h('td', { class: 'small muted', style: { textAlign: 'right', whiteSpace: 'nowrap' } }, `${done}/${c.sections.length}`));
      })));

    const decks = h('div', { class: 'card' }, h('h2', {}, 'Slide decks'),
      allDecks().length ? h('table', { class: 'list' }, ...allDecks().map((d) => {
        const linked = d.slides.filter((s) => s.sections?.length || st.userLinks[`slide:${d.id}#${s.number}`]?.sections?.length).length;
        const done = d.slides.filter((s) => st.studied[`slide:${d.id}#${s.number}`]?.on).length;
        return h('tr', {},
          h('td', {}, h('a', { href: `#/slides/${d.id}/1` }, d.title), h('div', { class: 'muted small' }, `${d.slides.length} slides · ${linked} linked to the book${d.imported ? ' · imported on this device' : ''}`), h('div', { class: 'progress', style: { marginTop: '.3rem', maxWidth: '14rem' } }, h('span', { style: { width: `${(100 * done) / Math.max(d.slides.length, 1)}%` } }))),
          h('td', { class: 'small muted', style: { textAlign: 'right', whiteSpace: 'nowrap' } }, `${done}/${d.slides.length}`));
      })) : h('p', { class: 'muted' }, 'No decks yet. Add one in Settings or in content/slides/.'));

    const how = h('div', { class: 'card' }, h('h2', {}, 'How this app works'),
      h('ul', { class: 'small' },
        h('li', {}, h('b', {}, 'Book'), ': read chapter by chapter. Mark sections studied, bookmark them and keep notes.'),
        h('li', {}, h('b', {}, 'Slides'), ': every slide asks you to explain it in writing first. The coach checks your answer against the book sections the slide rests on, points at what is missing without telling you, checks the English, and only then shows the explanation written against the book.'),
        h('li', {}, h('b', {}, 'Teach it back'), ': every book section has the same exercise. Explaining from memory, then correcting, is what makes it stick.'),
        h('li', {}, h('b', {}, 'Downloads'), ': the book as PDF, EPUB, ZIP, HTML and Markdown; each deck as PDF and PPTX. Save them for offline use.'),
        h('li', {}, h('b', {}, 'Sync'), ': no account and no server. Export your notes and progress as a code, send it to your other device by e-mail, chat or QR, and import it there.'),
      ));

    root.replaceChildren(hero, stats, h('div', { class: 'grid', style: { marginTop: '1rem' } }, chapters, decks), h('div', { style: { marginTop: '1rem' } }, how));
  };
  draw();
  const off = onChange(draw);
  const onInstallable = () => draw();
  window.addEventListener('mmt:installable', onInstallable);
  return () => { off(); window.removeEventListener('mmt:installable', onInstallable); };
}

function installButton() {
  if (isNative() || matchMedia('(display-mode: standalone)').matches) return null;
  if (app.installPrompt) {
    return h('button', { class: 'btn', onclick: async () => { app.installPrompt.prompt(); await app.installPrompt.userChoice; app.installPrompt = null; } }, icon('download'), 'Install app');
  }
  return h('a', { class: 'btn', href: '#/settings', title: 'How to install on Windows, Android and Huawei' }, icon('download'), 'Install');
}
