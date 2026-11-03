/** Small BM25 index used to suggest book sections for a slide. */
const STOP = new Set('a an and are as at be but by for from has have if in into is it its of on or that the their then there these this to was were what when which with within without will would you your about also than more most over under per can may not no such each other'.split(' '));

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w) {
  if (w.length <= 4) return w;
  return w
    .replace(/(ations?|ising|izing|ised|ized)$/, 'at')
    .replace(/(ing|edly|ed|ly|es|s)$/, '')
    .replace(/(ies)$/, 'y');
}

export function buildIndex(docs) {
  // docs: [{id, text, title}]
  const N = docs.length;
  const df = new Map();
  const tf = [];
  let totalLen = 0;
  for (const d of docs) {
    const toks = tokenize(`${d.title} ${d.title} ${d.text}`);
    const m = new Map();
    for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    tf.push({ id: d.id, len: toks.length, m });
    totalLen += toks.length;
  }
  const avgLen = totalLen / Math.max(N, 1);
  const k1 = 1.4, b = 0.75;
  return {
    search(query, k = 5) {
      const q = Array.from(new Set(tokenize(query)));
      const scores = [];
      for (const d of tf) {
        let s = 0;
        for (const t of q) {
          const f = d.m.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
          s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen));
        }
        if (s > 0) scores.push({ id: d.id, score: s });
      }
      scores.sort((a, b2) => b2.score - a.score);
      const top = scores.slice(0, k);
      const max = top[0]?.score || 1;
      return top.map((r) => ({ ...r, rel: r.score / max }));
    },
  };
}
