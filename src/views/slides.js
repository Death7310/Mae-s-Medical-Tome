import { h, icon, toast } from '../lib/ui.js';
import { content, allDecks, deckById, sectionByRef, suggestSections, excerptsFor, highlight, hasBook, readHref } from '../lib/content.js';
import { deckBlob } from '../lib/library.js';
import { getState, isOn, toggle, noteOf, setNote, setProgress, setUserLinks, userLinksOf, onChange, practiceOf } from '../lib/store.js';
import { openPdf, renderPage } from '../lib/pdf.js';
import { practiceBox } from './practice.js';
import { aiConfigured, explainWithCoach } from '../lib/aicoach.js';

export async function render(root, params) {
  const decks = allDecks();
  if (!params[0]) return renderDeckList(root, decks);
  const deck = deckById(params[0]);
  if (!deck) { root.replaceChildren(h('div', { class: 'card' }, h('p', {}, 'Deck not found. '), h('a', { href: '#/slides' }, 'All decks'))); return; }
  const total = deck.slides.length || 1;
  let n = Math.min(Math.max(parseInt(params[1], 10) || getState().progress.lastSlides?.slide || 1, 1), total);
  let tab = sessionStorage.getItem('mmt:slideTab') || 'practice';

  const canvas = h('canvas', { 'aria-label': 'Slide image' });
  const wrap = h('div', { class: 'canvas-wrap' }, canvas);
  const counter = h('span', { class: 'counter' });
  const select = h('select', { 'aria-label': 'Go to slide', onchange: (e) => go(Number(e.target.value)) }, ...deck.slides.map((s) => h('option', { value: s.number }, `${s.number}. ${s.title}`)));
  const thumbs = h('div', { class: 'thumbs' });
  const stage = h('div', { class: 'stage' }, wrap,
    h('div', { class: 'slide-controls' }, h('button', { class: 'btn icon-only', 'aria-label': 'Previous slide', onclick: () => go(n - 1) }, icon('prev')), counter, select, h('button', { class: 'btn icon-only', 'aria-label': 'Next slide', onclick: () => go(n + 1) }, icon('next'))),
    thumbs);
  const panel = h('div', { class: 'panel' });
  root.replaceChildren(
    h('div', { class: 'row', style: { marginBottom: '.75rem' } }, h('a', { class: 'btn sm', href: '#/slides' }, icon('prev'), 'All decks'), h('h1', { style: { margin: 0, fontSize: '1.2rem' } }, deck.title)),
    h('div', { class: 'slides' }, stage, panel));

  let pdf = null;
  if (deck.kind === 'pdf') {
    try { const blob = await deckBlob(deck.id); pdf = await openPdf(deck.id, new Uint8Array(await blob.arrayBuffer())); } catch (e) { console.warn(e); }
  }

  async function draw() {
    const s = deck.slides[n - 1];
    counter.textContent = `${n} / ${total}`;
    select.value = String(n);
    thumbs.replaceChildren(...deck.slides.map((x) => h('button', { class: `${x.number === n ? 'active' : ''}${(x.sections?.length || userLinksOf(`slide:${deck.id}#${x.number}`).length) ? ' linked' : ''}`, onclick: () => go(x.number), title: x.title }, String(x.number))));
    const act = thumbs.querySelector('.active'); if (act) thumbs.scrollTo({ left: act.offsetLeft - thumbs.clientWidth / 2 + act.offsetWidth / 2 });
    if (pdf) {
      wrap.replaceChildren(canvas);
      try { await renderPage(pdf, n, canvas, wrap.clientWidth || 800, Math.max(window.innerHeight - 260, 240)); } catch (e) { wrap.replaceChildren(h('div', { class: 'fallback' }, h('p', {}, 'Could not render this page: ', e.message))); }
    } else if (s?.html) wrap.replaceChildren(h('div', { class: 'fallback', html: s.html }));
    else {
      const lines = (s?.text || '').split('\n').filter((l) => l.trim() && l.trim() !== s.title);
      wrap.replaceChildren(h('div', { class: 'fallback text' }, h('h2', {}, s?.title || `Slide ${n}`), lines.length ? h('ul', {}, ...lines.map((l) => h('li', {}, l))) : h('p', { class: 'muted' }, 'No readable text on this slide.')));
    }
    drawPanel();
    setProgress('lastSlides', { deck: deck.id, slide: n });
    history.replaceState(null, '', `#/slides/${deck.id}/${n}`);
  }
  function go(k) { if (k < 1 || k > total) return; n = k; draw(); }

  function drawPanel() {
    const s = deck.slides[n - 1] || { number: n, sections: [], text: '' };
    const sid = `slide:${deck.id}#${n}`;
    const auto = s.sections || [];
    const user = userLinksOf(sid).filter((r) => !auto.includes(r));
    const pr = practiceOf(sid);
    const tabs = h('div', { class: 'tabs' }, ...[['practice', `Practice${pr?.mastered ? ' ✓' : ''}`], ['book', `From the book${auto.length + user.length ? ` (${auto.length + user.length})` : ''}`], ['suggest', 'Find in book'], ['notes', 'Notes']].map(([k, label]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { tab = k; sessionStorage.setItem('mmt:slideTab', k); drawPanel(); } }, label)));
    let body;
    if (tab === 'practice') body = practiceTab(s, sid, auto, user);
    else if (tab === 'book') body = bookTab(s, sid, auto, user);
    else if (tab === 'suggest') body = suggestTab(s, sid, auto, user);
    else body = notesTab(s, sid);
    panel.replaceChildren(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '.25rem' } }, h('strong', {}, s.title || `Slide ${n}`), h('span', { class: 'row' }, smallToggle('studied', sid, 'check', 'Studied'), smallToggle('bookmarks', sid, 'star', ''))), tabs, body);
  }

  function practiceTab(s, sid, auto, user) {
    const refs = [...auto, ...user];
    const frag = document.createDocumentFragment();
    if (!hasBook()) frag.append(h('p', { class: 'notice warn small' }, 'No book loaded, so answers can only be checked for writing. ', h('a', { href: '#/home' }, 'Load the book'), '.'));
    frag.append(practiceBox({ id: sid, studyId: sid, kind: 'slide', title: s.title, sectionRefs: refs }));
    frag.append(h('p', { class: 'muted small', style: { marginTop: '.75rem' } }, 'Method: write first, check, read the hint, rewrite. Open "From the book" only after an attempt; that is when it sticks.'));
    return frag;
  }

  function bookTab(s, sid, auto, user) {
    const frag = document.createDocumentFragment();
    const refs = [...auto.map((r) => ({ r, user: false })), ...user.map((r) => ({ r, user: true }))];
    if (!hasBook()) { frag.append(h('p', { class: 'muted' }, h('a', { href: '#/home' }, 'Load the book'), ' to see what it says about this slide.')); return frag; }
    if (!refs.length) { frag.append(h('p', { class: 'muted' }, 'No section of the book matches this slide\'s wording closely enough to link automatically. Use ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); tab = 'suggest'; drawPanel(); } }, 'Find in book'), ' to search and link one yourself.')); return frag; }
    const attempted = (practiceOf(sid)?.attempts || 0) > 0;
    const inner = document.createDocumentFragment();
    for (const { r, user: isUser } of refs) {
      const hit = sectionByRef(r); if (!hit) continue;
      const ex = excerptsFor(s, r, 4);
      const full = h('div', { class: 'excerpt', html: hit.section.html });
      const more = h('button', { class: 'btn sm', onclick: () => { full.classList.toggle('open'); more.textContent = full.classList.contains('open') ? 'Show less' : 'Read the whole section'; } }, 'Read the whole section');
      inner.append(h('div', { class: 'linked-sec' },
        h('div', { class: 'crumb' }, `${content.books.length > 1 ? hit.book.title + ' · ' : ''}Chapter ${hit.chapter.number} · ${hit.chapter.title}`, h('span', { class: 'chip', style: { marginLeft: '.4rem' } }, isUser ? 'your link' : 'matched by wording')),
        h('h4', {}, hit.section.title),
        ex.sentences.length ? h('div', { class: 'explain' }, h('h4', {}, 'What the book says about this slide'), ...ex.sentences.map((sent) => h('p', { html: highlight(sent, ex.terms) }))) : h('p', { class: 'muted small' }, 'No single sentence stands out; read the section.'),
        full,
        h('div', { class: 'row', style: { marginTop: '.5rem' } }, more, h('a', { class: 'btn sm', href: readHref(r) }, icon('book'), 'Open in book'),
          isUser ? h('button', { class: 'btn sm danger', onclick: () => { setUserLinks(sid, user.filter((x) => x !== r)); drawPanel(); } }, 'Unlink') : null)));
    }
    if (aiConfigured()) {
      const out = h('div');
      inner.append(h('div', { class: 'row', style: { margin: '.5rem 0' } }, h('button', { class: 'btn sm', onclick: async (e) => { const b = e.target.closest('button'); b.disabled = true; out.replaceChildren(h('p', { class: 'muted small' }, 'Asking the coach…')); try { const txt = await explainWithCoach({ slideTitle: s.title, slideText: s.text, passages: refs.map(({ r }) => sectionByRef(r)?.section.text).filter(Boolean) }); out.replaceChildren(h('div', { class: 'explain ai' }, h('h4', {}, 'AI coach, from these passages only'), ...txt.split(/\n{2,}/).map((p) => h('p', {}, p)))); } catch (err) { out.replaceChildren(h('p', { class: 'notice warn small' }, err.message)); } b.disabled = false; } }, icon('sync'), 'Explain the link with the AI coach')), out);
    }
    if (attempted) frag.append(inner);
    else frag.append(h('details', { class: 'explain gated' }, h('summary', {}, 'The book\'s explanation is waiting. Try the Practice tab first, then open this.'), inner), h('p', { class: 'small' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); tab = 'practice'; sessionStorage.setItem('mmt:slideTab', 'practice'); drawPanel(); } }, 'Go to Practice →')));
    return frag;
  }

  function suggestTab(s, sid, auto, user) {
    const frag = document.createDocumentFragment();
    if (!hasBook()) { frag.append(h('p', { class: 'muted' }, h('a', { href: '#/home' }, 'Load the book'), ' first.')); return frag; }
    frag.append(h('p', { class: 'muted small' }, 'Sections whose wording best matches this slide, ranked. Link the ones that fit; your links sync with your notes.'));
    if (!s.text?.trim()) frag.append(h('p', { class: 'notice warn' }, 'No text could be read from this slide (it may be an image), so nothing can be suggested automatically. Search below.'));
    const rows = (items) => items.length ? items.map((x) => {
      const linked = auto.includes(x.ref) || user.includes(x.ref);
      return h('div', { class: 'linked-sec' }, h('div', { class: 'crumb' }, `${content.books.length > 1 ? x.book.title + ' · ' : ''}Chapter ${x.chapter.number} · ${x.chapter.title}`), h('h4', {}, x.section.title), h('div', { class: 'small muted' }, x.section.text.slice(0, 180) + '…'), h('div', { class: 'rel' }, h('span', { style: { width: `${Math.round(x.rel * 100)}%` } })),
        h('div', { class: 'row', style: { marginTop: '.5rem' } }, linked ? h('span', { class: 'chip ok' }, icon('check'), 'linked') : h('button', { class: 'btn sm primary', onclick: () => { setUserLinks(sid, [...user, x.ref]); toast('Linked to this slide', 'ok', 1500); drawPanel(); } }, icon('link'), 'Link to this slide'), h('a', { class: 'btn sm', href: readHref(x.ref) }, 'Open')));
    }) : [h('p', { class: 'muted' }, 'No matches.')];
    const list = h('div', {}, ...rows(suggestSections(`${s.title || ''}\n${s.text || ''}`, 6).filter((x) => x.section)));
    frag.append(h('input', { type: 'search', placeholder: 'Search the book…', oninput: (e) => list.replaceChildren(...rows(suggestSections(e.target.value, 8).filter((x) => x.section))) }), h('div', { style: { height: '.6rem' } }), list);
    return frag;
  }

  function notesTab(s, sid) {
    return h('div', {}, h('textarea', { placeholder: 'Your notes for this slide…', style: { minHeight: '10rem' }, oninput: (e) => setNote(sid, e.target.value) }, noteOf(sid)),
      h('p', { class: 'muted small' }, 'Notes save automatically on this device and travel in your sync code.'),
      s.text ? h('details', {}, h('summary', { class: 'muted small' }, 'Text read from the slide'), h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, s.text)) : null);
  }
  function smallToggle(coll, id, ic, label) { return h('button', { class: `btn sm${isOn(coll, id) ? ' on' : ''}`, title: label || coll, onclick: () => { toggle(coll, id); drawPanel(); } }, icon(ic), label || null); }

  const onKey = (e) => { if (e.target.matches('input,textarea,select')) return; if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(n + 1); } if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(n - 1); } };
  let tx = null;
  const onTs = (e) => { tx = e.touches[0].clientX; };
  const onTe = (e) => { if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 60) go(dx < 0 ? n + 1 : n - 1); };
  let rt; const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 150); };
  window.addEventListener('keydown', onKey); wrap.addEventListener('touchstart', onTs, { passive: true }); wrap.addEventListener('touchend', onTe); window.addEventListener('resize', onResize);
  const off = onChange(() => {});
  await draw();
  return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); off(); };
}

function renderDeckList(root, decks) {
  const st = getState();
  root.replaceChildren(h('h1', {}, 'Slide decks'),
    decks.length ? h('div', { class: 'grid' }, ...decks.map((d) => {
      const linked = d.slides.filter((s) => s.sections?.length || st.userLinks[`slide:${d.id}#${s.number}`]?.sections?.length).length;
      const done = d.slides.filter((s) => st.studied[`slide:${d.id}#${s.number}`]?.on).length;
      const last = st.progress.lastSlides?.deck === d.id ? st.progress.lastSlides.slide : 1;
      return h('div', { class: 'card deck-card' }, h('h3', {}, d.title), h('p', { class: 'small' }, `${d.slides.length} slides · ${linked} linked to the book · ${done} studied`), h('div', { class: 'progress' }, h('span', { style: { width: `${(100 * done) / Math.max(d.slides.length, 1)}%` } })),
        h('div', { class: 'row', style: { marginTop: '.8rem' } }, h('a', { class: 'btn primary', href: `#/slides/${d.id}/${last}` }, icon('slides'), last > 1 ? `Continue at ${last}` : 'Open'), h('a', { class: 'btn', href: `#/slides/${d.id}/1` }, 'From the start')));
    })) : h('div', { class: 'card' }, h('p', {}, 'No slides loaded yet. ', h('a', { href: '#/home' }, 'Add a deck in the Library'), '.')));
}
