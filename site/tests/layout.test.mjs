import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../layout.js', import.meta.url), 'utf8');
const L = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.deepEqual(L.onePageFrame(297, 167.1, 'half', 0.75, 1), [
  { x: 21, y: 8.5, w: 106.6, h: 142.1 }, 159.5,
]);
assert.deepEqual(L.onePageFrame(297, 167.1, 'fit', 0.75, 1), [
  { x: 8.5, y: 8.5, w: 112.6, h: 150.1 }, 129.1,
]);

const cols = L.columns([{ script: 'latin' }, { script: 'han' }, { script: 'latin' }], 11, 199, 3);
assert.deepEqual(cols, { xs: [11, 73, 142.5], widths: [56.5, 64, 56.5] });
assert.deepEqual(L.bookletSides(8), [[7, 0], [1, 6], [5, 2], [3, 4]]);

const book = {
  languages: ['en', 'zh', 'pl', 'fr'], titles: { en: 'Test', zh: '测试', pl: 'Test', fr: 'Test' },
  pictures: { colour: { 1: 'one.jpg' }, small: { 1: 'small.png' }, covers: { front: 'front.jpg', back: 'back.jpg' } },
};
const story = [{ number: 1, title: { en: 'One', zh: '一', pl: 'Jeden', fr: 'Un' }, text: { en: 'Words', zh: '文字', pl: 'Słowa', fr: 'Mots' } }];
const meta = { en: 'English', zh: '中文', pl: 'Polski', fr: 'Français' };

const four = L.buildLayout({ book, story, languageMeta: meta, settings: L.normaliseSettings(book, 'custom') });
assert.equal(four.widthMm, 210);
assert.equal(four.pages.filter(p => p.kind === 'text').length, 1);
assert.match(four.pages.find(p => p.kind === 'text').html, /data-lang="fr"/);
assert.equal(four.pages.at(-1).kind, 'back');

const oneBook = { ...book, languages: ['en'], titles: { en: 'Test' } };
const one = L.buildLayout({ book: oneBook, story, languageMeta: meta, settings: L.normaliseSettings(oneBook, 'tv') });
assert.equal(one.pages.filter(p => p.kind === 'text').length, 1);
assert.match(one.pages.find(p => p.kind === 'text').html, /data-lang="en"/);

const a5 = L.buildLayout({ book, story, languageMeta: meta, settings: L.normaliseSettings(book, 'a5') });
assert.deepEqual([a5.widthMm, a5.heightMm], [148.5, 210]);
assert.equal(a5.pages.length % 4, 0);
assert.equal(a5.sheets.length, a5.pages.length / 2);

console.log('layout.js: 12 checks passed');
