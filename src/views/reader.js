import { h, icon, toast } from '../lib/ui.js';
import { content, chapterById, slidesForSection } from '../lib/content.js';
import { getState, isOn, toggle, noteOf, setNote, setProgress, onChange, practiceOf } from '../lib/store.js';
import { practiceBox } from './practice.js';

export async function render(root, params) {
  const book = content.book;
  if (!book) { root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'No book loaded'), h('p', {}, h('a', { href: '#/home' }, 'Load your book in the Library'), ' and it will appear here, split into chapters and sections.'))); return; }
  const st = getState();
  let chapterId = params[0] || st.progress.lastBook?.chapter || book.chapters[0].id;
  let chapter = chapterById(chapterId) || book.chapters[0];
  const sectionId = params[1] || (params[0] ? null : st.progress.lastBook?.section);

  const tocList = () => h('ol', {}, ...book.chapters.map((c) => [
    h('li', { class: 'chapter' }, h('a', { href: `#/read/${c.id}`, class: c.id === chapter.id ? 'active' : '' }, `${c.number}. ${c.title}`)),
    ...(c.id === chapter.id ? c.sections.map((s) => h('li', { class: 'sec' }, h('a', { href: `#/read/${c.id}/${s.id}`, dataset: { sec: s.id } }, s.title, isOn('studied', `book:${c.id}#${s.id}`) ? h('span', { class: 'done' }, icon('check')) : null))) : []),
  ]));

  const aside = h('aside', { class: 'card', 'aria-label': 'Contents' }, h('h3', {}, 'Contents'), tocList());
  const mobileToc = h('details', { class: 'mobile-toc card' }, h('summary', {}, `Chapter ${chapter.number}: ${chapter.title}`), tocList());

  const article = h('article', { class: 'book' }, h('h1', {}, `Chapter ${chapter.number}. ${chapter.title}`),
    ...chapter.sections.map((s) => sectionEl(chapter, s)),
    chapterNav(chapter));

  root.replaceChildren(h('div', { class: 'reader' }, aside, h('div', {}, mobileToc, article)));

  // jump to requested section
  if (sectionId) requestAnimationFrame(() => document.getElementById(`sec-${sectionId}`)?.scrollIntoView({ block: 'start' }));
  setProgress('lastBook', { chapter: chapter.id, section: sectionId || chapter.sections[0].id });

  // track the section in view for progress + ToC highlight
  const io = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    const sec = vis.target.dataset.sec;
    aside.querySelectorAll('a[data-sec]').forEach((a) => a.classList.toggle('active', a.dataset.sec === sec));
    setProgress('lastBook', { chapter: chapter.id, section: sec });
  }, { rootMargin: '-10% 0px -70% 0px' });
  article.querySelectorAll('section[data-sec]').forEach((el) => io.observe(el));

  const off = onChange(() => {
    // refresh toggle states without re-rendering text
    article.querySelectorAll('[data-toggle]').forEach((b) => { const [coll, id] = b.dataset.toggle.split('|'); b.classList.toggle('on', isOn(coll, id)); });
    aside.replaceChildren(h('h3', {}, 'Contents'), tocList());
  });
  return () => { io.disconnect(); off(); };
}

function sectionEl(chapter, s) {
  const id = `book:${chapter.id}#${s.id}`;
  const ref = `${chapter.id}#${s.id}`;
  const notesBox = h('div', { class: 'sec-notes', style: { display: noteOf(id) ? 'block' : 'none' } },
    h('textarea', { placeholder: 'Your notes for this section…', oninput: (e) => setNote(id, e.target.value) }, noteOf(id)));
  const covering = slidesForSection(ref, getState().userLinks);
  const practiceHost = h('div', { class: 'sec-practice' });
  const pr = practiceOf(`practice:${ref}`);
  const teachBtn = h('button', { class: `btn sm${pr?.mastered ? ' on' : ''}`, onclick: () => {
    if (practiceHost.childElementCount) { practiceHost.replaceChildren(); return; }
    practiceHost.replaceChildren(practiceBox({ id: `practice:${ref}`, studyId: id, kind: 'section', title: s.title, sectionRefs: [ref] }));
    practiceHost.querySelector('textarea')?.focus();
  } }, icon('slides'), pr?.mastered ? 'Teach it back ✓' : 'Teach it back');
  const tools = h('div', { class: 'sec-tools' },
    /^references$/i.test(s.title) ? null : teachBtn,
    toggleBtn('studied', id, 'check', 'Studied'),
    toggleBtn('bookmarks', id, 'star', 'Bookmark'),
    h('button', { class: 'btn sm', onclick: () => { notesBox.style.display = notesBox.style.display === 'none' ? 'block' : 'none'; notesBox.querySelector('textarea').focus(); } }, 'Notes'),
    h('span', { class: 'spacer' }),
    ...covering.slice(0, 4).map((c) => h('a', { class: 'chip accent', href: `#/slides/${c.deck.id}/${c.slide.number}`, title: c.deck.title }, icon('slides'), `Slide ${c.slide.number}`)),
    covering.length > 4 ? h('span', { class: 'chip' }, `+${covering.length - 4} more`) : null,
  );
  const body = h('div', { html: s.html });
  // heading is inside html; put tools right after the h2
  const h2 = body.querySelector('h2');
  const sec = h('section', { id: `sec-${s.id}`, dataset: { sec: s.id } });
  if (h2) { sec.append(h2); }
  sec.append(tools, body, practiceHost, notesBox);
  return sec;
}

function toggleBtn(coll, id, ic, label) {
  return h('button', { class: `btn sm${isOn(coll, id) ? ' on' : ''}`, dataset: { toggle: `${coll}|${id}` }, onclick: (e) => { toggle(coll, id); if (coll === 'studied' && isOn(coll, id)) toast('Marked as studied', 'ok', 1500); } }, icon(ic), label);
}

function chapterNav(chapter) {
  const i = content.book.chapters.findIndex((c) => c.id === chapter.id);
  const prev = content.book.chapters[i - 1];
  const next = content.book.chapters[i + 1];
  return h('div', { class: 'chapter-nav' },
    prev ? h('a', { class: 'btn', href: `#/read/${prev.id}` }, icon('prev'), prev.title) : h('span'),
    next ? h('a', { class: 'btn primary', href: `#/read/${next.id}` }, next.title, icon('next')) : h('a', { class: 'btn', href: '#/slides' }, 'Go to the slides', icon('next')));
}
