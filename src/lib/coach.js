/**
 * Offline coaching engine.
 *
 * Evaluates a learner's written answer against (a) authored key points,
 * (b) the terminology of the linked book sections, and (c) basic standards of
 * clear written English. It never reveals the answer: feedback names the
 * dimension that is missing, gives progressively stronger hints, and unlocks
 * the model answer only after real effort.
 *
 * Key point pattern syntax (authored in links.md):
 *   "label: groupA + groupB >> hint"
 *   groups are separated by "+", alternatives inside a group by "|".
 *   A key point is covered when EVERY group has at least one alternative
 *   present in the answer (word-start match, so "clos" matches "closure").
 *
 * Pure module: no DOM, works in Node for tests.
 */

const STOP = new Set('a an and are as at be but by for from has have had if in into is it its of on or that the their then there these this to was were what when which with within without will would you your about also than more most over under per can may not no such each other do does did done onto upon via one two three first second during after before between while until around against through across along toward towards up out off set get like just very both either neither all any some many much few less own same so too only here where how why whose whom who because since although though whether always never usually often still already again yet even now rather roughly about near nearly almost called known means mean marks mark occurs occur shows show happens happen they them start end normal typical value values example case way given used use using mmhg ml min per cent percent'.split(' '));

export function normalise(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compilePattern(pattern) {
  return String(pattern).split('+').map((g) => g.split('|').map((a) => normalise(a).trim()).filter(Boolean)).filter((g) => g.length);
}

export function altMatches(norm, alt) {
  // word-start match; multi-word alternatives may be separated by any whitespace/hyphen
  const re = new RegExp(`(^|[^a-z0-9])${alt.split(/\s+/).map(esc).join('[\\s-]+')}`);
  return re.test(norm);
}

export function patternHit(norm, groups) {
  return groups.every((g) => g.some((alt) => altMatches(norm, alt)));
}

export function parseKeyPoint(line) {
  // "label: pattern >> hint"
  let [body, hint = ''] = String(line).split('>>');
  const i = body.indexOf(':');
  if (i < 0) return { label: body.trim(), pattern: body.trim(), hint: hint.trim() };
  return { label: body.slice(0, i).trim(), pattern: body.slice(i + 1).trim(), hint: hint.trim() };
}

// ------------------------------------------------------------ key terms
export function tokens(text) {
  return normalise(text).replace(/[^a-z0-9%]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** df index over a corpus of texts so that terms special to one section rank high. */
export function buildDfIndex(texts) {
  const df = new Map();
  for (const t of texts) for (const w of new Set([...tokens(t), ...bigrams(null, t)])) df.set(w, (df.get(w) || 0) + 1);
  return { df, N: texts.length };
}

/** Adjacent-word pairs taken from the original word order, never across punctuation or a stop word. */
function bigrams(_toks, text) {
  const out = [];
  if (!text) return out;
  for (const clause of normalise(text).split(/[.,;:!?()\[\]"=×+−*\/]+|\s[x]\s/)) {
    const ws = clause.replace(/[^a-z0-9%\s-]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < ws.length - 1; i++) {
      const a = ws[i], b = ws[i + 1];
      if (STOP.has(a) || STOP.has(b) || a.length < 2 || b.length < 2 || /^\d+$/.test(a) || /^\d+$/.test(b)) continue;
      out.push(`${a} ${b}`);
    }
  }
  return out;
}

/** Top terms (unigrams + bigrams) of a text by tf-idf; abbreviations like S1, MAP, RAAS are kept. */
export function extractKeyTerms(text, dfIndex, k = 10) {
  const toks = tokens(text);
  // abbreviations as written in the text (S1, MAP, NTS, RAAS, ADH …) are allowed through the length filter
  const abbrevs = new Set((String(text).match(/\b[A-Z][A-Z0-9]{1,5}\b/g) || []).map((a) => a.toLowerCase()));
  const tf = new Map();
  for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
  for (const b of bigrams(toks, text)) tf.set(b, (tf.get(b) || 0) + 1);
  const N = dfIndex?.N || 1;
  const scored = [];
  for (const [w, f] of tf) {
    const isBigram = w.includes(' ');
    if (!isBigram && w.length < 5 && !/\d/.test(w) && !abbrevs.has(w)) continue;
    const d = dfIndex?.df.get(w) || 1;
    // a pair that occurs once is kept only when it is rare across the book (a real term, not a chance pairing)
    if (isBigram && f < 2 && d > Math.max(1, N * 0.2)) continue;
    const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
    // repeated pairs are strong terms; one-off pairs only slightly beat a single word; abbreviations like S1 or MAP get a boost
    const weight = isBigram ? (f >= 2 ? 2.2 : 1.15) : (/\d/.test(w) ? 1.5 : 1);
    scored.push({ term: w, score: f * idf * weight });
  }
  scored.sort((a, b) => b.score - a.score);
  // drop unigrams that are already inside a chosen bigram
  const chosen = [];
  for (const s of scored) {
    if (chosen.length >= k) break;
    if (!s.term.includes(' ') && chosen.some((c) => c.term.includes(' ') && c.term.split(' ').includes(s.term))) continue;
    if (s.term.includes(' ') && chosen.some((c) => !c.term.includes(' ') && s.term.split(' ').includes(c.term))) {
      // prefer the bigram: replace the unigram
      const i = chosen.findIndex((c) => !c.term.includes(' ') && s.term.split(' ').includes(c.term));
      chosen.splice(i, 1);
    }
    chosen.push(s);
  }
  return chosen.map((c) => c.term);
}

export function termUsed(norm, term) {
  // allow simple inflection: match the stem (strip trailing s/es) at a word start
  const stem = term.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
  return altMatches(norm, stem.length >= 4 ? stem : term);
}

// ------------------------------------------------------------ writing quality
const MISSPELLINGS = {
  seperate: 'separate', occured: 'occurred', occuring: 'occurring', recieve: 'receive', definately: 'definitely', begining: 'beginning', untill: 'until', alot: 'a lot', wich: 'which', becuase: 'because', teh: 'the', thier: 'their', beleive: 'believe', neccessary: 'necessary', occurence: 'occurrence', accross: 'across', basicly: 'basically', truely: 'truly', acheive: 'achieve', independant: 'independent', existance: 'existence', tendancy: 'tendency', ventrical: 'ventricle', ventricals: 'ventricles', pulmonery: 'pulmonary', coranary: 'coronary', hemorage: 'haemorrhage', haemorrage: 'haemorrhage', diastoly: 'diastole', systoly: 'systole', arterys: 'arteries', capillarys: 'capillaries', atrias: 'atria', atriums: 'atria', valvs: 'valves', resistence: 'resistance', recepters: 'receptors', recepter: 'receptor', sympathic: 'sympathetic', parasympathic: 'parasympathetic', kidnies: 'kidneys',
};
const VAGUE = ['thing', 'things', 'stuff', 'kind of', 'sort of', 'basically', 'etc', 'and so on', 'somehow', 'whatever'];
const HEDGES = ['i think', 'i guess', 'maybe', 'probably', 'i believe', 'not sure', 'i feel like'];
const CAUSAL = ['because', 'since', 'therefore', 'so that', ' so ', 'leads to', 'lead to', 'results in', 'result in', 'causes', 'caused by', 'due to', 'which means', 'as a result', 'consequently', 'hence', 'thus', 'in order to', 'produces', 'allows', 'prevents', 'when ', 'if '];

const ABBREV = /(^|\s)(e\.g\.|i\.e\.|etc\.|vs\.|cf\.|dr\.|mr\.|mrs\.|ms\.|prof\.|fig\.|approx\.|no\.|[a-z]\.|[a-z]\.[a-z]\.)$/i;
export function splitSentences(text) {
  const parts = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

export function analyseWriting(text, { expectsMechanism = true } = {}) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const sentences = splitSentences(trimmed);
  const norm = normalise(trimmed);
  const issues = []; // things to fix
  const tips = [];   // things that would make it better
  if (!words.length) return { words: 0, sentences: 0, issues: [{ kind: 'empty', msg: 'Write your answer first.' }], tips, avgSentence: 0 };

  if (words.length < 20) issues.push({ kind: 'short', msg: `Only ${words.length} words. A clear explanation needs 3 to 5 full sentences: what it is, how it works, and why it matters.` });
  else if (words.length < 40 && expectsMechanism) tips.push({ kind: 'detail', msg: 'Good start. Add one more sentence of detail: a mechanism, a number, or a consequence.' });

  if (words.length > 25 && sentences.length === 1) issues.push({ kind: 'runon', msg: 'This is one long sentence. Break it into separate sentences, one claim each.' });
  const long = sentences.filter((s) => s.split(/\s+/).length > 35);
  if (long.length && sentences.length > 1) issues.push({ kind: 'long', msg: `Sentence too long to follow (${long[0].split(/\s+/).length} words): "${long[0].slice(0, 60)}…". Split it.` });

  if (!/[.!?]["')]?$/.test(trimmed)) issues.push({ kind: 'punct', msg: 'Finish the last sentence with a full stop.' });
  const lower = sentences.filter((s) => /^[a-z]/.test(s));
  if (lower.length) issues.push({ kind: 'caps', msg: `Start every sentence with a capital letter ("${lower[0].slice(0, 30)}…").` });
  if (/(^|\s)i(\s|'|,)/.test(trimmed)) issues.push({ kind: 'pronoun', msg: 'Write the pronoun "I" as a capital.' });
  const dup = /\b(\w+)\s+\1\b/i.exec(trimmed);
  if (dup && !/^\d+$/.test(dup[1])) issues.push({ kind: 'dup', msg: `Repeated word: "${dup[0]}".` });
  for (const [bad, good] of Object.entries(MISSPELLINGS)) if (new RegExp(`\\b${bad}\\b`).test(norm)) issues.push({ kind: 'spell', msg: `Spelling: "${bad}" should be "${good}".` });
  const ofM = /\b(could|should|would|must|might) of\b/i.exec(trimmed);
  if (ofM) issues.push({ kind: 'grammar', msg: `"${ofM[0]}" should be "${ofM[1]} have".` });
  const vague = VAGUE.filter((v) => new RegExp(`\\b${esc(v)}\\b`).test(norm));
  if (vague.length) issues.push({ kind: 'vague', msg: `Replace vague wording (${vague.map((v) => `"${v}"`).join(', ')}) with the precise term.` });
  const hedges = HEDGES.filter((v) => norm.includes(v));
  if (hedges.length) tips.push({ kind: 'hedge', msg: `State it directly instead of hedging ("${hedges[0]}"). If you are unsure, check the section and then commit.` });
  if (/\b(don't|doesn't|can't|isn't|aren't|won't|it's|that's)\b/i.test(trimmed)) tips.push({ kind: 'formal', msg: 'Prefer full forms (does not, cannot, it is) in a written explanation.' });
  if (expectsMechanism && words.length >= 20 && !CAUSAL.some((c) => norm.includes(c))) tips.push({ kind: 'mechanism', msg: 'You list facts but do not connect them. Show the mechanism: "because", "which leads to", "so that", "as a result".' });
  const passive = sentences.filter((s) => /\b(is|are|was|were|be|been|being)\s+(\w+ed|\w+en)\b/i.test(s)).length;
  if (sentences.length >= 3 && passive / sentences.length > 0.6) tips.push({ kind: 'passive', msg: 'Most sentences are passive. Name the actor: "the ventricle contracts" rather than "contraction is produced".' });

  return { words: words.length, sentences: sentences.length, avgSentence: Math.round(words.length / Math.max(sentences.length, 1)), issues, tips };
}

// ------------------------------------------------------------ hints
/** Sentence from the book that best matches a key point (used as a late-stage hint). */
export function bookSentenceFor(groups, sectionTexts) {
  let best = null, bestScore = 0;
  for (const text of sectionTexts) {
    for (const s of splitSentences(text)) {
      const n = normalise(s);
      let score = 0;
      for (const g of groups) if (g.some((a) => altMatches(n, a))) score++;
      if (score > bestScore && score >= Math.max(1, groups.length - 1)) { best = s; bestScore = score; }
    }
  }
  return best;
}

// ------------------------------------------------------------ evaluation
/**
 * @param {object} p
 * @param {string} p.answer
 * @param {Array<{label,pattern,hint}>} p.keyPoints  authored rubric (may be empty)
 * @param {string[]} p.terms  key terminology of the linked sections
 * @param {string[]} p.sectionTexts  plain text of linked sections (for late hints)
 * @param {number} p.attempt  1-based attempt number
 * @param {boolean} p.expectsMechanism
 */
export function evaluateAnswer({ answer, keyPoints = [], terms = [], sectionTexts = [], attempt = 1, expectsMechanism = true }) {
  const norm = normalise(answer);
  const writing = analyseWriting(answer, { expectsMechanism });
  const coverage = keyPoints.map((kp) => {
    const groups = compilePattern(kp.pattern);
    return { label: kp.label, hit: patternHit(norm, groups), groups, hint: kp.hint };
  });
  const termsUsed = terms.filter((t) => termUsed(norm, t));
  const termsUnused = terms.filter((t) => !termUsed(norm, t));
  const covered = coverage.filter((c) => c.hit).length;
  const total = coverage.length;
  const contentScore = total ? covered / total : terms.length ? termsUsed.length / terms.length : (writing.words >= 40 ? 0.7 : 0.3);
  const writingScore = Math.max(0, 1 - 0.15 * writing.issues.length - 0.05 * writing.tips.length);

  let band;
  if (!writing.words) band = 'empty';
  else if (contentScore >= 0.85 && writing.issues.length === 0) band = 'complete';
  else if (contentScore >= 0.6) band = 'close';
  else if (contentScore >= 0.3) band = 'developing';
  else band = 'starting';

  // next hint: first missing key point, strength grows with attempts
  let hint = null;
  const missing = coverage.find((c) => !c.hit);
  if (missing) {
    if (attempt <= 1) hint = { level: 1, text: `Something about "${missing.label}" is still missing. Re-read the linked section with that question in mind, then try again.` };
    else if (attempt === 2) hint = { level: 2, text: missing.hint || `Focus on "${missing.label}". Which specific event, structure or number does the book name for it?` };
    else {
      const s = bookSentenceFor(missing.groups, sectionTexts);
      hint = { level: 3, text: `For "${missing.label}", the book says: "${s || 'see the linked section'}". Now put that in your own words and connect it to the rest of your answer.` };
    }
  } else if (!total && termsUnused.length && attempt >= 2) {
    hint = { level: 2, text: `Your explanation would be more precise with the book's own terms. You have not yet used: ${termsUnused.slice(0, 4).join(', ')}.` };
  } else if (!total && attempt <= 1 && contentScore < 0.85) {
    hint = { level: 1, text: `You have used ${termsUsed.length} of ${terms.length} key terms from the section. Re-read it and name the specific structures, events and numbers.` };
  }

  const unlockModel = attempt >= 3 || (contentScore >= 0.85);
  const messages = {
    empty: 'Write your answer first, in full sentences, as if teaching a classmate.',
    starting: 'Most of the key ideas are still missing, and that is normal on a first try. Go back to the section, then explain it without looking.',
    developing: 'You are building the picture. Some key ideas are there; the ones below are not yet. Add them, and connect each to the others.',
    close: 'Nearly there. The core is right. Tighten the missing piece and the wording, and this will be a complete explanation.',
    complete: 'You covered the key ideas in correct, precise English. Mark it studied, or push further: what would change if one variable moved?',
  };
  return { band, message: messages[band], coverage: coverage.map(({ groups, ...c }) => c), covered, total, termsUsed, termsUnused, contentScore, writingScore, writing, hint, unlockModel, attempt };
}

/** Auto question when the author has not written one. */
export function autoQuestion(kind, title) {
  if (kind === 'section') return `Without looking at the text, explain "${title}" in your own words: what it is, how it works, and why it matters clinically.`;
  return `Explain, in your own words, what this slide is teaching. Say what each item means, how the items connect, and use the terminology from the linked book section.`;
}
