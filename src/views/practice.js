/**
 * "Teach it back" practice box: the learner writes an explanation in their own
 * words; the coach checks it against the book and guides without answering.
 * Used by the slide view (per slide) and the reader (per section).
 */
import { h, icon, toast } from '../lib/ui.js';
import { coachMaterial } from '../lib/content.js';
import { evaluateAnswer, autoQuestion } from '../lib/coach.js';
import { practiceOf, savePractice, toggle, isOn } from '../lib/store.js';
import { aiConfigured, askCoach } from '../lib/aicoach.js';

const BAND = {
  empty: ['', 'Not started'], starting: ['warn', 'Starting'], developing: ['warn', 'Developing'], close: ['accent', 'Nearly there'], complete: ['ok', 'Clear and complete'],
};

export function practiceBox({ id, studyId, kind, title, question, keyPoints = [], sectionRefs = [], modelHtml = '', expectsMechanism = true }) {
  const material = coachMaterial(sectionRefs);
  const q = question || autoQuestion(kind, title);
  let saved = practiceOf(id) || { attempts: 0, answer: '' };
  const root = h('div', { class: 'practice' });
  const ta = h('textarea', { class: 'answer', placeholder: 'Write your explanation here in full sentences, as if teaching a classmate who has not read the chapter. Do not look at the text while you write.', spellcheck: 'true' }, saved.answer || '');
  const counter = h('span', { class: 'muted small' });
  const feedback = h('div', { class: 'feedback' });
  const aiOut = h('div');
  const status = h('span', { class: 'row' });
  let draftTimer;
  const updateCounter = () => { const n = ta.value.trim().split(/\s+/).filter(Boolean).length; counter.textContent = `${n} word${n === 1 ? '' : 's'}`; };
  ta.addEventListener('input', () => { updateCounter(); clearTimeout(draftTimer); draftTimer = setTimeout(() => savePractice(id, { answer: ta.value }), 600); });
  updateCounter();

  const drawStatus = () => {
    saved = practiceOf(id) || saved;
    const [cls, label] = BAND[saved.band || 'empty'];
    status.replaceChildren(...[
      saved.attempts ? h('span', { class: 'chip' }, `${saved.attempts} attempt${saved.attempts === 1 ? '' : 's'}`) : null,
      saved.band ? h('span', { class: `chip ${cls}` }, label) : null,
      saved.mastered ? h('span', { class: 'chip ok' }, icon('check'), 'mastered') : null,
    ].filter(Boolean));
  };

  const check = () => {
    const answer = ta.value;
    const attempt = (saved.attempts || 0) + 1;
    const r = evaluateAnswer({ answer, keyPoints, terms: material.terms, sectionTexts: material.texts, attempt, expectsMechanism });
    if (r.band === 'empty') { toast(r.message, 'error'); return; }
    savePractice(id, { answer, attempts: attempt, band: r.band, covered: r.covered, total: r.total, mastered: !!(saved.mastered || r.band === 'complete') });
    drawStatus();
    renderFeedback(r);
    feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  function renderFeedback(r) {
    const [cls, label] = BAND[r.band];
    const parts = [h('div', { class: `notice ${cls}` }, h('b', {}, label, '. '), r.message)];
    if (r.total) {
      parts.push(h('div', { class: 'coverage' }, h('h4', {}, `Key ideas: ${r.covered} of ${r.total}`), h('ul', {}, ...r.coverage.map((c) => h('li', { class: c.hit ? 'hit' : 'miss' }, icon(c.hit ? 'check' : 'prev', c.hit ? '' : 'dim'), c.label)))));
    } else if (material.terms.length) {
      parts.push(h('div', { class: 'coverage' }, h('h4', {}, `Book terminology used: ${r.termsUsed.length} of ${material.terms.length}`), h('div', { class: 'row' }, ...r.termsUsed.map((t) => h('span', { class: 'chip ok' }, t)), ...(r.attempt >= 2 ? r.termsUnused.map((t) => h('span', { class: 'chip' }, t)) : []))));
    }
    if (r.hint) parts.push(h('div', { class: 'hint' }, h('h4', {}, r.hint.level >= 3 ? 'From the book' : 'Hint'), h('p', {}, r.hint.text)));
    if (r.writing.issues.length || r.writing.tips.length) {
      parts.push(h('div', { class: 'coverage' }, h('h4', {}, 'Writing'),
        r.writing.issues.length ? h('ul', { class: 'issues' }, ...r.writing.issues.map((i) => h('li', {}, i.msg))) : h('p', { class: 'small ok-text' }, icon('check'), ` Clean sentences: ${r.writing.sentences} sentence${r.writing.sentences === 1 ? '' : 's'}, about ${r.writing.avgSentence} words each.`),
        r.writing.tips.length ? h('ul', { class: 'tips' }, ...r.writing.tips.map((i) => h('li', {}, i.msg))) : null));
    } else if (r.writing.words) {
      parts.push(h('p', { class: 'small ok-text' }, icon('check'), ` Writing: ${r.writing.sentences} clear sentence${r.writing.sentences === 1 ? '' : 's'}, nothing to fix.`));
    }
    if (r.total && r.attempt >= 2) parts.push(h('p', { class: 'muted small' }, `Terms you have used: ${r.termsUsed.join(', ') || 'none yet'}.${r.termsUnused.length ? ` Still available: ${r.termsUnused.slice(0, 5).join(', ')}.` : ''}`));
    if (r.unlockModel && modelHtml) parts.push(h('details', { class: 'model' }, h('summary', {}, r.band === 'complete' ? 'Compare with the model answer' : 'Model answer (unlocked after three attempts): read it, then close it and rewrite yours'), h('div', { html: modelHtml })));
    else if (modelHtml) parts.push(h('p', { class: 'muted small' }, `A model answer unlocks after three attempts or a complete answer (attempt ${r.attempt} of 3).`));
    if (r.band === 'complete' && studyId) parts.push(h('div', { class: 'row' }, h('button', { class: `btn sm${isOn('studied', studyId) ? ' on' : ''}`, onclick: (e) => { toggle('studied', studyId); e.target.closest('button').classList.toggle('on', isOn('studied', studyId)); } }, icon('check'), 'Mark as studied'), h('span', { class: 'muted small' }, 'Then come back in a few days and explain it again from memory.')));
    feedback.replaceChildren(...parts);
  }

  const ai = async () => {
    if (!ta.value.trim()) { toast('Write your answer first.', 'error'); return; }
    if (!navigator.onLine) { toast('You are offline. The AI coach needs a connection; the offline check still works.', 'error'); return; }
    aiBtn.disabled = true;
    aiOut.replaceChildren(h('p', { class: 'muted small' }, 'Asking the coach…'));
    try {
      const attempt = Math.max(saved.attempts || 0, 1);
      const res = await askCoach({ question: q, answer: ta.value, sectionTexts: material.texts, attempt });
      const [cls, label] = BAND[res.verdict] || ['', ''];
      aiOut.replaceChildren(h('div', { class: 'ai' },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h4', {}, 'AI coach'), res.verdict ? h('span', { class: `chip ${cls}` }, label) : null),
        res.correct?.length ? h('div', {}, h('b', { class: 'small' }, 'What is right'), h('ul', {}, ...res.correct.map((x) => h('li', {}, x)))) : null,
        res.to_fix?.length ? h('div', {}, h('b', { class: 'small' }, 'To work on'), h('ul', {}, ...res.to_fix.map((x) => h('li', {}, x)))) : null,
        res.language?.length ? h('div', {}, h('b', { class: 'small' }, 'Language'), h('table', { class: 'lang' }, ...res.language.map((l) => h('tr', {}, h('td', { class: 'q' }, `“${l.quote}”`), h('td', { class: 'f' }, l.fix), h('td', { class: 'muted small' }, l.why))))) : null,
        res.next_step ? h('p', {}, h('b', {}, 'Next step: '), res.next_step) : null,
        res.encouragement ? h('p', { class: 'muted' }, res.encouragement) : null,
        h('p', { class: 'muted small' }, `Grounded in: ${material.titles.join('; ')}. Model: ${res.model || ''}.`)));
    } catch (e) { aiOut.replaceChildren(h('p', { class: 'notice warn small' }, e.message)); }
    aiBtn.disabled = false;
  };
  const aiBtn = h('button', { class: 'btn', onclick: ai, title: 'Uses your own API key (Settings → AI coach)' }, icon('sync'), 'Ask the AI coach');

  root.append(
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', { style: { margin: 0 } }, kind === 'section' ? 'Teach it back' : 'Your turn'), status),
    h('p', { class: 'question' }, q),
    ta,
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: check }, icon('check'), 'Check my answer'), aiConfigured() ? aiBtn : null,
        h('button', { class: 'btn sm', onclick: () => { if (confirm('Clear this answer and start again? Your attempt count is kept.')) { ta.value = ''; updateCounter(); savePractice(id, { answer: '' }); feedback.replaceChildren(); aiOut.replaceChildren(); } } }, 'Start again')),
      counter),
    h('p', { class: 'muted small' }, sectionRefs.length ? `Checked against: ${material.titles.join('; ')}.` : 'No book section is linked yet, so only the writing can be checked. Link one under "Find in book".'),
    feedback, aiOut);
  drawStatus();
  return root;
}
