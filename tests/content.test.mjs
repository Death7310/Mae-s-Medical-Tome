import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, parseFrontMatter, splitSections, parseLinksMd, parseSlideBlocks, htmlToText } from '../scripts/build-content.mjs';
import { buildIndex, tokenize } from '../src/lib/search.js';

test('slugify matches the ids used in links.md', () => {
  assert.equal(slugify('Short-term regulation: the baroreceptor reflex'), 'short-term-regulation-the-baroreceptor-reflex');
  assert.equal(slugify('Systolic, diastolic, pulse and mean pressure'), 'systolic-diastolic-pulse-and-mean-pressure');
  assert.equal(slugify('  Pressure–volume loops '), 'pressure-volume-loops');
});

test('front matter and section splitting', () => {
  const { data, body } = parseFrontMatter('---\nid: x\ntitle: Hello: world\n---\nintro\n\n## A\n\ntext a\n\n### A1\n\nmore\n\n## B\n\ntext b');
  assert.equal(data.id, 'x');
  assert.equal(data.title, 'Hello: world');
  const secs = splitSections(body);
  assert.deepEqual(secs.map((s) => s.title), [null, 'A', 'B']);
  assert.match(secs[1].markdown, /### A1/);
});

test('links.md parser', () => {
  const l = parseLinksMd('<!-- c -->\n## Slide 2\nsections: a#b, c#d\n\nSome **text**.\n\n## Slide 5\nNo sections here.');
  assert.deepEqual(l[2].sections, ['a#b', 'c#d']);
  assert.equal(l[2].markdown, 'Some **text**.');
  assert.deepEqual(l[5].sections, []);
});

test('slide block parser handles headings, lists and tables', () => {
  const b = parseSlideBlocks('# T\n\n- one\n- two\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n\npara here');
  assert.deepEqual(b.map((x) => x.type), ['heading', 'list', 'table', 'para']);
  assert.deepEqual(b[2].rows, [['h1', 'h2'], ['a', 'b']]);
  assert.equal(htmlToText('<p>a &amp; b</p><ul><li>c</li></ul>'), 'a & b\nc');
});

test('BM25 suggests the right section for slide text', () => {
  const idx = buildIndex([
    { id: 'hs', title: 'Heart sounds', text: 'S1 marks mitral and tricuspid closure. S2 marks aortic and pulmonary closure. S3 occurs in early diastole during rapid filling.' },
    { id: 'map', title: 'Mean arterial pressure', text: 'MAP is estimated as diastolic plus one third of the pulse pressure. Pulse pressure is systolic minus diastolic.' },
    { id: 'baro', title: 'Baroreceptor reflex', text: 'Carotid sinus and aortic arch stretch receptors signal via cranial nerves IX and X to the nucleus tractus solitarius.' },
  ]);
  assert.equal(idx.search('S1 AV valves close, S2 semilunar valves close, S3 rapid filling')[0].id, 'hs');
  assert.equal(idx.search('MAP ≈ DBP + 1/3 (SBP − DBP), pulse pressure')[0].id, 'map');
  assert.equal(idx.search('carotid sinus CN IX aortic arch CN X NTS')[0].id, 'baro');
  assert.ok(tokenize('The baroreceptors reset').includes('baroreceptor'));
});
