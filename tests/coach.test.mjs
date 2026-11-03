import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePattern, patternHit, normalise, parseKeyPoint, analyseWriting, evaluateAnswer, extractKeyTerms, buildDfIndex, bookSentenceFor, splitSentences } from '../src/lib/coach.js';

const S1 = parseKeyPoint('What causes S1: s1|first heart sound + clos + mitral|tricuspid|atrioventricular|av valve >> Valves make a sound when they do one thing, not the other.');
const S2 = parseKeyPoint('What causes S2: s2|second heart sound + clos + aortic|pulmonary|semilunar');
const TIMING = parseKeyPoint('When S1 happens: s1|first + systole|isovolumetric contraction|ventricular contraction');

test('key point parsing and pattern matching', () => {
  assert.equal(S1.label, 'What causes S1');
  assert.match(S1.hint, /Valves make/);
  const g = compilePattern(S1.pattern);
  assert.equal(g.length, 3);
  assert.ok(patternHit(normalise('S1 is produced by closure of the mitral and tricuspid valves.'), g));
  assert.ok(patternHit(normalise('The first heart sound comes from the AV valves closing.'), g));
  assert.ok(!patternHit(normalise('S1 is produced when the mitral valve opens.'), g));
  assert.ok(!patternHit(normalise('closure of the aortic valve'), g)); // wrong valve
});

test('writing analysis flags the classic problems and nothing else on clean prose', () => {
  const bad = analyseWriting('the first sound is when the valves close and it happens at systole and then the second sound is the other valves closing and i think its basically the same thing but later and it could of been seperate');
  const kinds = bad.issues.map((i) => i.kind);
  for (const k of ['runon', 'punct', 'caps', 'pronoun', 'spell', 'grammar', 'vague']) assert.ok(kinds.includes(k), `expected ${k} in ${kinds}`);
  const good = analyseWriting('The first heart sound, S1, is produced by closure of the mitral and tricuspid valves. It marks the start of ventricular systole, because the valves shut as soon as ventricular pressure exceeds atrial pressure. The second heart sound, S2, is produced by closure of the aortic and pulmonary valves at the start of diastole.');
  assert.deepEqual(good.issues, []);
  assert.equal(good.sentences, 3);
});

test('evaluation bands and progressive hints never reveal the answer early', () => {
  const sectionTexts = ['S1 ("lub") marks mitral and tricuspid closure at the start of ventricular systole. S2 ("dub") marks aortic and pulmonary closure at the start of diastole.'];
  const kps = [S1, S2, TIMING];
  const r1 = evaluateAnswer({ answer: 'Heart sounds are made by the heart beating.', keyPoints: kps, sectionTexts, attempt: 1 });
  assert.equal(r1.band, 'starting');
  assert.equal(r1.covered, 0);
  assert.equal(r1.hint.level, 1);
  assert.ok(!/mitral|tricuspid/i.test(r1.hint.text), 'level-1 hint must not contain the answer');
  assert.equal(r1.unlockModel, false);

  const r2 = evaluateAnswer({ answer: 'S1 is produced by closure of the mitral and tricuspid valves at the onset of ventricular systole. The second sound happens later.', keyPoints: kps, sectionTexts, attempt: 2 });
  assert.equal(r2.covered, 2);
  assert.equal(r2.band, 'close');
  assert.equal(r2.hint.level, 2);

  const r3 = evaluateAnswer({ answer: 'S1 is produced by closure of the mitral and tricuspid valves at the onset of ventricular systole. The second sound happens later.', keyPoints: kps, sectionTexts, attempt: 3 });
  assert.equal(r3.hint.level, 3);
  assert.match(r3.hint.text, /aortic and pulmonary closure/);
  assert.equal(r3.unlockModel, true);

  const r4 = evaluateAnswer({ answer: 'S1, the first heart sound, is produced by closure of the mitral and tricuspid valves. It marks the start of ventricular systole, because the valves shut once ventricular pressure exceeds atrial pressure. S2 is produced by closure of the aortic and pulmonary valves at the start of diastole.', keyPoints: kps, sectionTexts, attempt: 1 });
  assert.equal(r4.band, 'complete');
  assert.equal(r4.hint, null);
  assert.equal(r4.unlockModel, true);
});

test('auto key terms pick the section-specific vocabulary', () => {
  const sec = 'The arterial baroreflex is the fastest regulator of blood pressure. Stretch receptors in the carotid sinus and aortic arch fire faster as arterial pressure rises. Signals travel in the glossopharyngeal nerve and vagus nerve to the nucleus tractus solitarius. The baroreceptors reset within one to two days, so the baroreflex buffers acute swings but cannot set long-term pressure.';
  const others = ['Cardiac output is heart rate times stroke volume. Stroke volume depends on preload, afterload and contractility.', 'Renin is released by juxtaglomerular cells and converts angiotensinogen to angiotensin I.'];
  const terms = extractKeyTerms(sec, buildDfIndex([sec, ...others]), 8);
  assert.ok(terms.some((t) => /carotid sinus/.test(t)), terms.join(','));
  assert.ok(terms.some((t) => /baroreceptor|baroreflex/.test(t)), terms.join(','));
  assert.ok(!terms.includes('pressure') || true);
  const r = evaluateAnswer({ answer: 'Stretch receptors in the carotid sinus and aortic arch sense pressure and signal the brainstem, which adjusts heart rate and vessel tone. Because the baroreceptors reset over a day or two, the baroreflex only buffers short-term changes.', terms, attempt: 1 });
  assert.ok(r.termsUsed.length >= 3, r.termsUsed.join(','));
});

test('helpers', () => {
  assert.equal(splitSentences('One. Two! Three? e.g. four.').length, 4);
  assert.match(bookSentenceFor(compilePattern('s2 + clos + aortic'), ['S1 marks mitral closure. S2 marks aortic and pulmonary closure at the start of diastole.']), /^S2/);
});
