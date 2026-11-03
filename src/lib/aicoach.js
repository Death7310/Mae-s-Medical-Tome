/**
 * Optional AI coach. Uses the learner's own Anthropic API key, stored only on
 * this device, and calls the Claude API directly from the browser. Grounded
 * strictly in the book passages the question is linked to. Off by default.
 */
import { pref } from './store.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const aiConfigured = () => !!(pref('aiKey', '') || '').trim();

const SYSTEM = `You are a patient Socratic tutor helping a medical student teach themselves from their own textbook.

You receive: the question, the exact book passages the question is based on, the student's written answer, and the attempt number.

Rules
1. Ground everything in the passages. Do not add facts from elsewhere. If the passages do not cover something, say so.
2. Do not give the answer. On attempts 1 and 2 never state a missing fact outright: ask one pointed question or name the dimension that is missing (for example "you have not yet said what event produces the second sound"). From attempt 3 you may quote the relevant sentence of the passages.
3. Start with what is correct, specifically.
4. Accuracy: if a statement contradicts the passages, quote the student's statement and say it conflicts with the book. Supply the correction only from attempt 3.
5. English: for each grammar, spelling, punctuation or clarity problem, quote the phrase, give the corrected phrase, and say why in a few words. Correcting language is always allowed, including on attempt 1.
6. Terminology: name the book's terms the student used correctly, and point to imprecise wording and which book term would be precise.
7. Push for articulation: ask for mechanism (because, so that, which leads to), for numbers where the book gives them, and for consequences.
8. Tone: warm, direct, no flattery, no lecturing. At most 180 words of prose in total across all fields.

Respond with JSON only, no markdown fences, in exactly this shape:
{"verdict":"starting|developing|close|complete","correct":["..."],"to_fix":["..."],"language":[{"quote":"...","fix":"...","why":"..."}],"next_step":"...","encouragement":"..."}`;

export async function askCoach({ question, answer, sectionTexts, attempt }) {
  const apiKey = (pref('aiKey', '') || '').trim();
  if (!apiKey) throw new Error('No API key set. Add one under Settings → AI coach.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 90_000 });
  const passages = sectionTexts.map((t, i) => `<passage index="${i + 1}">\n${t}\n</passage>`).join('\n\n');
  const user = `<question>\n${question}\n</question>\n\n<book_passages>\n${passages}\n</book_passages>\n\n<attempt>${attempt}</attempt>\n\n<student_answer>\n${answer}\n</student_answer>`;
  let res;
  try {
    res = await client.beta.messages.create({
      model: pref('aiModel', DEFAULT_MODEL),
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('The API key was rejected. Check it under Settings → AI coach.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API. Wait a moment and try again.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the API. Are you online? The offline check still works.');
    if (e instanceof Anthropic.APIError) throw new Error(`API error ${e.status}: ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('The coach declined to answer this one.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const out = JSON.parse(json);
    return { ...out, raw: text, model: res.model, usage: res.usage };
  } catch {
    return { verdict: null, correct: [], to_fix: [], language: [], next_step: text, encouragement: '', raw: text, model: res.model };
  }
}
