import { h, icon, toast, escapeHtml } from '../lib/ui.js';
import { content, allDecks, deckById, sectionByRef, suggestSections, importedBlob, url } from '../lib/content.js';
import { getState, isOn, toggle, noteOf, setNote, setProgress, setUserLinks, userLinksOf, onChange } from '../lib/store.js';
import { openPdf, renderPage } from '../lib/pdf.js';
import { practiceBox } from './practice.js';
import { practiceOf } from '../lib/store.js';

export async function render(root, params) {
  const decks = allDecks();
  if (!params[0]) return renderDeckList(root, decks);
  const deck = deckById(params[0]);
  if (!deck) { root.replaceChildren(h('div', { class: 'card' }, h('p', {}, 'Deck not found. '), h('a', { href: '#/slides' }, 'All decks'))); return; }
  const total = deck.slides.length || 1;
  let n = Math.min(Math.max(parseInt(params[1], 10) || getState().progress.lastSlides?.slide || 1, 1), total);
  let tab = sessionStorage.getItem('mmt:slideTab') || 'practice';

  // ---- stage
  const canvas = h('canvas', { 'aria-label': 'Slide image' });
  const wrap = h('div', { class: 'canvas-wrap' }, canvas);
  const counter = h('span', { class: 'counter' });
  const select = h('select', { 'aria-label': 'Go to slide', onchange: (e) => go(Number(e.target.value)) }, ...deck.slides.map((s) => h('option', { value: s.number }, `${s.number}. ${s.title}`)));
  const thumbs = h('div', { class: 'thumbs' });
  const stage = h('div', { class: 'stage' }, wrap,
    h('div', { class: 'slide-controls' },
      h('button', { class: 'btn icon-only', 'aria-label': 'Previous slide', onclick: () => go(n - 1) }, icon('prev')),
      counter, select,
      h('button', { class: 'btn icon-only', 'aria-label': 'Next slide', onclick: () => go(n + 1) }, icon('next'))),
    thumbs);

  const panel = h('div', { class: 'panel' });
  root.replaceChildren(
    h('div', { class: 'row', style: { marginBottom: '.75rem' } }, h('a', { class: 'btn sm', href: '#/slides' }, icon('prev'), 'All decks'), h('h1', { style: { margin: 0, fontSize: '1.2rem' } }, deck.title)),
    h('div', { class: 'slides' }, stage, panel));

  // ---- pdf
  let pdf = null;
  let pdfError = null;
  try {
    if (deck.imported) { const blob = await importedBlob(deck.id); pdf = await openPdf(deck.id, new Uint8Array(await blob.arrayBuffer())); }
    else if (deck.files?.pdf) pdf = await openPdf(deck.id, url(deck.files.pdf));
  } catch (e) { pdfError = e; console.warn(e); }

  async function draw() {
    const s = deck.slides[n - 1];
    counter.textContent = `${n} / ${total}`;
    select.value = String(n);
    thumbs.replaceChildren(...deck.slides.map((x) => h('button', { class: `${x.number === n ? 'active' : ''}${(x.sections?.length || userLinksOf(`slide:${deck.id}#${x.number}`).length) ? ' linked' : ''}`, onclick: () => go(x.number), title: x.title }, String(x.number))));
    const act = thumbs.querySelector('.active'); if (act) thumbs.scrollTo({ left: act.offsetLeft - thumbs.clientWidth / 2 + act.offsetWidth / 2 });
    if (pdf) {
      const maxW = wrap.clientWidth || 800;
      const maxH = Math.max(window.innerHeight - 260, 240);
      wrap.replaceChildren(canvas);
      try { await renderPage(pdf, n, canvas, maxW, maxH); } catch (e) { wrap.replaceChildren(h('div', { class: 'fallback' }, h('p', {}, 'Could not render this page: ', e.message))); }
    } else if (s?.html) {
      wrap.replaceChildren(h('div', { class: 'fallback', html: s.html }));
    } else {
      wrap.replaceChildren(h('div', { class: 'fallback' }, h('h2', {}, s?.title || `Slide ${n}`), h('pre', { style: { whiteSpace: 'pre-wrap', font: 'inherit' } }, s?.text || ''), pdfError ? h('p', { class: 'muted small' }, 'PDF not available: ', pdfError.message) : null));
    }
    drawPanel();
    setProgress('lastSlides', { deck: deck.id, slide: n });
    history.replaceState(null, '', `#/slides/${deck.id}/${n}`);
  }

  function go(k) { if (k < 1 || k > total) return; n = k; draw(); }

  // ---- side panel
  function drawPanel() {
    const s = deck.slides[n - 1] || { number: n, sections: [], text: '' };
    const sid = `slide:${deck.id}#${n}`;
    const built = s.sections || [];
    const user = userLinksOf(sid).filter((r) => !built.includes(r));
    const pr = practiceOf(sid);
    const tabs = h('div', { class: 'tabs' }, ...[['practice', `Practice${pr?.mastered ? ' ✓' : ''}`], ['explain', `Explanation${built.length + user.length ? ` (${built.length + user.length})` : ''}`], ['suggest', 'Find in book'], ['notes', 'Notes']].map(([k, label]) => h('button', { class: k === tab ? 'active' : '', onclick: () => { tab = k; sessionStorage.setItem('mmt:slideTab', k); drawPanel(); } }, label)));
    let body;
    if (tab === 'practice') body = practiceTab(s, sid, built, user);
    else if (tab === 'explain') body = explainTab(s, sid, built, user);
    else if (tab === 'suggest') body = suggestTab(s, sid, built, user);
    else body = notesTab(s, sid);
    panel.replaceChildren(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '.25rem' } }, h('strong', {}, s.title || `Slide ${n}`), h('span', { class: 'row' }, smallToggle('studied', sid, 'check', 'Studied'), smallToggle('bookmarks', sid, 'star', ''))), tabs, body);
  }

  function practiceTab(s, sid, built, user) {
    let refs = [...built, ...user];
    if (!refs.length && s.text?.trim()) refs = suggestSections(`${s.title || ''}\n${s.text}`, 2).filter((x) => x.section && x.rel > 0.5).map((x) => x.ref);
    const frag = document.createDocumentFragment();
    frag.append(practiceBox({ id: sid, studyId: sid, kind: 'slide', title: s.title, question: s.practice?.question, keyPoints: s.practice?.keyPoints || [], sectionRefs: refs, modelHtml: s.practice?.modelHtml || '' }));
    frag.append(h('p', { class: 'muted small', style: { marginTop: '.75rem' } }, 'Method: write first, check, read the hint, rewrite. Open the Explanation tab only after an attempt; that is when it sticks.'));
    return frag;
  }

  function explainTab(s, sid, built, user) {
    const frag = document.createDocumentFragment();
    const attempted = (practiceOf(sid)?.attempts || 0) > 0;
    if (s.explanationHtml && (attempted || !s.practice?.question)) frag.append(h('div', { class: 'explain' }, h('h4', {}, 'Explanation, following the book'), h('div', { html: s.explanationHtml })));
    else if (s.explanationHtml) {
      const d = h('details', { class: 'explain gated' }, h('summary', {}, 'Explanation is waiting. Try the Practice tab first, then open this.'), h('div', { html: s.explanationHtml }));
      frag.append(d, h('p', { class: 'small' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); tab = 'practice'; sessionStorage.setItem('mmt:slideTab', 'practice'); drawPanel(); } }, 'Go to Practice →')));
    }
    const refs = [...built.map((r) => ({ r, user: false })), ...user.map((r) => ({ r, user: true }))];
    if (!refs.length) {
      frag.append(h('p', { class: 'muted' }, 'This slide has no book links yet. Open ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); tab = 'suggest'; drawPanel(); } }, 'Find in book'), ' to see the sections that best match its text and link them.'));
    }
    for (const { r, user: isUser } of refs) {
      const hit = sectionByRef(r);
      if (!hit) continue;
      frag.append(linkedSection(hit, isUser, sid, user));
    }
    return frag;
  }

  function linkedSection(hit, isUser, sid, userRefs) {
    const excerpt = h('div', { class: 'excerpt', html: hit.section.html.replace(/^<h2[^>]*>.*?<\/h2>/s, '') });
    const more = h('button', { class: 'btn sm', onclick: () => { excerpt.classList.toggle('open'); more.textContent = excerpt.classList.contains('open') ? 'Show less' : 'Read the whole section'; } }, 'Read the whole section');
    return h('div', { class: 'linked-sec' },
      h('div', { class: 'crumb' }, `Chapter ${hit.chapter.number} · ${hit.chapter.title}`, isUser ? h('span', { class: 'chip', style: { marginLeft: '.4rem' } }, 'your link') : null),
      h('h4', {}, hit.section.title),
      excerpt,
      h('div', { class: 'row', style: { marginTop: '.5rem' } }, more,
        h('a', { class: 'btn sm', href: `#/read/${hit.chapter.id}/${hit.section.id}` }, icon('book'), 'Open in book'),
        isUser ? h('button', { class: 'btn sm danger', onclick: () => { setUserLinks(sid, userRefs.filter((x) => x !== hit.ref)); drawPanel(); } }, 'Unlink') : null));
  }

  function suggestTab(s, sid, built, user) {
    const text = `${s.title || ''}\n${s.text || ''}`;
    const sugg = suggestSections(text, 6).filter((x) => x.section);
    const frag = document.createDocumentFragment();
    frag.append(h('p', { class: 'muted small' }, 'Sections of the book whose wording best matches this slide (full-text search, ranked). Link the ones that fit; your links sync with your notes.'));
    if (!s.text?.trim()) frag.append(h('p', { class: 'notice warn' }, 'No text could be read from this slide (it may be an image), so nothing can be suggested. Use the search box below.'));
    const q = h('input', { type: 'search', placeholder: 'Search the book…', oninput: (e) => { list.replaceChildren(...rows(suggestSections(e.target.value, 8).filter((x) => x.section))); } });
    const rows = (items) => items.length ? items.map((x) => {
      const linked = built.includes(x.ref) || user.includes(x.ref);
      return h('div', { class: 'linked-sec' },
        h('div', { class: 'crumb' }, `Chapter ${x.chapter.number} · ${x.chapter.title}`),
        h('h4', {}, x.section.title),
        h('div', { class: 'small muted' }, x.section.text.slice(0, 180) + '…'),
        h('div', { class: 'rel' }, h('span', { style: { width: `${Math.round(x.rel * 100)}%` } })),
        h('div', { class: 'row', style: { marginTop: '.5rem' } },
          linked ? h('span', { class: 'chip ok' }, icon('check'), 'linked') : h('button', { class: 'btn sm primary', onclick: () => { setUserLinks(sid, [...user, x.ref]); toast('Linked to this slide', 'ok', 1500); drawPanel(); } }, icon('link'), 'Link to this slide'),
          h('a', { class: 'btn sm', href: `#/read/${x.chapter.id}/${x.section.id}` }, 'Open')));
    }) : [h('p', { class: 'muted' }, 'No matches.')];
    const list = h('div', {}, ...rows(sugg));
    frag.append(q, h('div', { style: { height: '.6rem' } }), list);
    return frag;
  }

  function notesTab(s, sid) {
    const ta = h('textarea', { placeholder: 'Your notes for this slide…', style: { minHeight: '10rem' }, oninput: (e) => setNote(sid, e.target.value) }, noteOf(sid));
    return h('div', {}, ta,
      h('p', { class: 'muted small' }, 'Notes save automatically on this device and travel in your sync code.'),
      s.text ? h('details', {}, h('summary', { class: 'muted small' }, 'Text read from the slide'), h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, s.text)) : null);
  }

  function smallToggle(coll, id, ic, label) {
    return h('button', { class: `btn sm${isOn(coll, id) ? ' on' : ''}`, title: label || coll, onclick: () => { toggle(coll, id); drawPanel(); } }, icon(ic), label || null);
  }

  // ---- interaction
  const onKey = (e) => { if (e.target.matches('input,textarea,select')) return; if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(n + 1); } if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(n - 1); } };
  let tx = null;
  const onTs = (e) => { tx = e.touches[0].clientX; };
  const onTe = (e) => { if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 60) go(dx < 0 ? n + 1 : n - 1); };
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(draw, 150); };
  window.addEventListener('keydown', onKey);
  wrap.addEventListener('touchstart', onTs, { passive: true });
  wrap.addEventListener('touchend', onTe);
  window.addEventListener('resize', onResize);
  const off = onChange(() => { /* toggles re-render themselves */ });
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
      return h('div', { class: 'card deck-card' }, h('h3', {}, d.title),
        h('div', { class: 'muted small' }, [d.lecturer, d.course].filter(Boolean).join(' · ') || (d.imported ? 'Imported PDF (this device only)' : '')),
        h('p', { class: 'small' }, `${d.slides.length} slides · ${linked} linked to the book · ${done} studied`),
        h('div', { class: 'progress' }, h('span', { style: { width: `${(100 * done) / Math.max(d.slides.length, 1)}%` } })),
        h('div', { class: 'row', style: { marginTop: '.8rem' } }, h('a', { class: 'btn primary', href: `#/slides/${d.id}/${last}` }, icon('slides'), last > 1 ? `Continue at ${last}` : 'Open'), h('a', { class: 'btn', href: `#/slides/${d.id}/1` }, 'From the start')));
    })) : h('div', { class: 'card' }, h('p', {}, 'No decks available.')),
    h('p', { class: 'muted small', style: { marginTop: '1rem' } }, 'Have a lecture PDF of your own? Add it under Settings → Import a slide deck. It stays on this device; your notes and links for it still sync.'));
}
