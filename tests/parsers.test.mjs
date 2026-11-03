import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
globalThis.DOMParser = DOMParser;
const { structurePdf, headingTiers, linesToText, structureFromPages } = await import('../src/lib/parsers/pdfbook.js');
const { parseHtmlBook, parseMarkdownBook } = await import('../src/lib/parsers/markup.js');
const { pptxSlideText, parseHtmlDeck } = await import('../src/lib/parsers/decks.js');
const { assembleBook, splitLong } = await import('../src/lib/parsers/text.js');
const { detectKind } = await import('../src/lib/parsers/index.js');

// synthetic PDF: 6 pages, body 10pt, chapter titles 20pt, section titles 14pt, running head 8pt
const WORDS = 'ventricle atrium valve pressure flow resistance output volume reflex nerve kidney sodium renin stretch closure'.split(' ');
const body = (n) => Array.from({ length: n }, (_, i) => [`The ${WORDS[i % 15]} and the ${WORDS[(i * 7) % 15]} relate to ${WORDS[(i * 3) % 15]} in body sentence ${i + 1}.`, 10, i % 4 === 0]);
const pages = [
  [['Mae Medical Tome', 8, false], ['The Heart', 20, true], ['Chambers and valves', 14, true], ...body(12), ['3', 8, true]],
  [['Mae Medical Tome', 8, false], ...body(10), ['Cardiac output', 14, true], ...body(8), ['4', 8, true]],
  [['Mae Medical Tome', 8, false], ['Blood Pressure', 20, true], ['Mean arterial pressure', 14, true], ...body(14), ['5', 8, true]],
  [['Mae Medical Tome', 8, false], ['The baroreflex', 14, true], ...body(12), ['6', 8, true]],
  [['Mae Medical Tome', 8, false], ['Long-term control', 14, true], ...body(12), ['7', 8, true]],
  [['Mae Medical Tome', 8, false], ['The Kidney', 20, true], ['Pressure natriuresis', 14, true], ...body(12), ['8', 8, true]],
];

test('pdf heading tiers and structure', () => {
  const t = headingTiers(pages);
  assert.equal(t.body, 10); assert.equal(t.chapterSize, 20); assert.equal(t.sectionSize, 14);
  const { book, mode, available } = structurePdf(pages, null, 'Test');
  assert.equal(mode, 'headings');
  assert.deepEqual(available, ['headings', 'pages']);
  assert.deepEqual(book.chapters.map((c) => c.title), ['The Heart', 'Blood Pressure', 'The Kidney']);
  assert.deepEqual(book.chapters[1].sections.map((s) => s.title), ['Mean arterial pressure', 'The baroreflex', 'Long-term control']);
  assert.ok(!book.chapters[0].sections[0].text.includes('Mae Medical Tome'), 'running head removed');
  assert.equal(book.chapters[0].sections[0].id, 'chambers-and-valves');
  assert.equal(book.chapters[1].id, 'blood-pressure');
});

test('pdf outline structure wins when present', () => {
  const outline = [{ title: 'Heart', depth: 1, page: 1 }, { title: 'Valves', depth: 2, page: 1 }, { title: 'Output', depth: 2, page: 2 }, { title: 'Pressure', depth: 1, page: 3 }, { title: 'Kidney', depth: 1, page: 6 }];
  const { book, mode } = structurePdf(pages, outline, 'Test');
  assert.equal(mode, 'outline');
  assert.deepEqual(book.chapters.map((c) => c.title), ['Heart', 'Pressure', 'Kidney']);
  assert.deepEqual(book.chapters[0].sections.map((s) => s.title), ['Valves', 'Output']);
  const forced = structurePdf(pages, outline, 'Test', 'pages');
  assert.equal(forced.mode, 'pages');
  assert.ok(forced.book.chapters[0].sections.length >= 1);
});

test('line joining fixes hyphenation and keeps paragraph gaps', () => {
  assert.equal(linesToText([['The ventri-', 10, true], ['cle contracts.', 10, false], ['Next paragraph.', 10, true]]), 'The ventricle contracts.\n\nNext paragraph.');
});

test('html and markdown books split at heading levels with stable ids', async () => {
  const html = '<html><head><title>My Book</title></head><body><h1>Chapter One</h1><p>Intro text here that is long enough.</p><h2>First section</h2><p>Section body.</p><h2>Second section</h2><p>More body.</p><h1>Chapter Two</h1><h2>Only section</h2><p>Text.</p></body></html>';
  const b = parseHtmlBook(html, 'x');
  assert.equal(b.title, 'My Book');
  assert.deepEqual(b.chapters.map((c) => c.title), ['Chapter One', 'Chapter Two']);
  assert.deepEqual(b.chapters[0].sections.map((s) => s.title), ['Chapter One', 'First section', 'Second section']);
  assert.match(b.chapters[0].sections[1].html, /<p>Section body\.<\/p>/);
  const m = await parseMarkdownBook('# Title\n\n## A\n\ntext a\n\n## B\n\ntext b\n\n# Two\n\n## C\n\ntext c', 'file');
  assert.deepEqual(m.chapters.map((c) => c.title), ['Title', 'Two']);
  assert.deepEqual(m.chapters[0].sections.map((s) => s.id), ['a', 'b']);
});

test('pptx slide xml text and html decks', () => {
  const xml = '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Heart </a:t></a:r><a:r><a:t>sounds</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>S1 closes AV valves</a:t></a:r></a:p><a:p><a:r><a:t>S2 &amp; semilunar</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
  const r = pptxSlideText(xml);
  assert.equal(r.title, 'Heart sounds');
  assert.equal(r.text, 'Heart sounds\nS1 closes AV valves\nS2 & semilunar');
  const d = parseHtmlDeck('<section class="slide"><h1>One</h1><p>a</p></section><section class="slide"><h1>Two</h1><p>b</p></section>');
  assert.deepEqual(d.map((s) => s.title), ['One', 'Two']);
});

test('long sections split and ids stay deterministic', () => {
  const long = Array.from({ length: 300 }, (_, i) => `Sentence ${i} is here.`).join(' ');
  assert.ok(splitLong(long, 200, 300).length >= 3);
  const b = assembleBook('T', [{ chapterTitle: 'C', sectionTitle: 'S', text: long }]);
  assert.ok(b.chapters[0].sections.length >= 2);
  assert.equal(b.chapters[0].sections[0].id, 's-part-1');
  assert.equal(detectKind('x.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])), 'pdf');
  assert.equal(detectKind('x.pptx', new Uint8Array([0x50, 0x4b, 3, 4])), 'pptx');
  assert.equal(detectKind('notes.md'), 'md');
});
