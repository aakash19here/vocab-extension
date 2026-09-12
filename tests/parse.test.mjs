import test from 'node:test';
import assert from 'node:assert/strict';

import { isWordLike, normalizeNotionId, splitWordAndMeaning, truncate } from '../src/parse.js';

test('splits a dictionary-style selection on a dash', () => {
  assert.deepEqual(splitWordAndMeaning('ubiquitous — present everywhere'), {
    word: 'ubiquitous',
    meaning: 'present everywhere',
  });
  assert.deepEqual(splitWordAndMeaning('ubiquitous - present everywhere'), {
    word: 'ubiquitous',
    meaning: 'present everywhere',
  });
});

test('splits on a colon and drops the punctuation', () => {
  assert.deepEqual(splitWordAndMeaning('petrichor: the smell of rain on dry earth'), {
    word: 'petrichor',
    meaning: 'the smell of rain on dry earth',
  });
});

test('prefers a short first line over any inline separator', () => {
  const selection = 'sanguine\noptimistic or positive: especially in a bad situation';
  assert.deepEqual(splitWordAndMeaning(selection), {
    word: 'sanguine',
    meaning: 'optimistic or positive: especially in a bad situation',
  });
});

test('keeps hyphenated words intact', () => {
  assert.deepEqual(splitWordAndMeaning('self-effacing: not claiming attention for oneself'), {
    word: 'self-effacing',
    meaning: 'not claiming attention for oneself',
  });
});

test('a bare word becomes the word, a long passage becomes the meaning', () => {
  assert.deepEqual(splitWordAndMeaning('  defenestration '), {
    word: 'defenestration',
    meaning: '',
  });

  const passage =
    'the act of throwing someone or something out of a window, which is a surprisingly specific thing to have a word for';
  assert.deepEqual(splitWordAndMeaning(passage), { word: '', meaning: passage });
});

test('does not split when the left side is a whole sentence', () => {
  const selection =
    'This sentence is far too long to be a headword and therefore should not be split: really';
  assert.equal(splitWordAndMeaning(selection).word, '');
});

test('collapses whitespace and handles empty input', () => {
  assert.deepEqual(splitWordAndMeaning('ersatz —  a  poor\n  substitute '), {
    word: 'ersatz',
    meaning: 'a poor substitute',
  });
  assert.deepEqual(splitWordAndMeaning(''), { word: '', meaning: '' });
  assert.deepEqual(splitWordAndMeaning(undefined), { word: '', meaning: '' });
});

test('isWordLike accepts short phrases only', () => {
  assert.equal(isWordLike('ad hoc'), true);
  assert.equal(isWordLike('a phrase of exactly six words here'), false);
  assert.equal(isWordLike('x'.repeat(61)), false);
});

test('normalizeNotionId accepts links, ids and dashed uuids', () => {
  const dashed = '1a2b3c4d-5e6f-7081-9203-a4b5c6d7e8f9';
  const flat = '1a2b3c4d5e6f70819203a4b5c6d7e8f9';

  assert.equal(normalizeNotionId(flat), dashed);
  assert.equal(normalizeNotionId(dashed), dashed);
  assert.equal(normalizeNotionId(`https://www.notion.so/My-Vocabulary-${flat}`), dashed);
  assert.equal(normalizeNotionId(`https://www.notion.so/workspace/${dashed}?pvs=4`), dashed);
});

test('normalizeNotionId prefers the page id over a ?v= view id', () => {
  const page = '1a2b3c4d5e6f70819203a4b5c6d7e8f9';
  const view = 'ffffffffffffffffffffffffffffffff';
  assert.equal(
    normalizeNotionId(`https://www.notion.so/Words-${page}?v=${view}&pvs=4`),
    '1a2b3c4d-5e6f-7081-9203-a4b5c6d7e8f9',
  );
});

test('normalizeNotionId rejects junk', () => {
  assert.equal(normalizeNotionId(''), null);
  assert.equal(normalizeNotionId('just some words'), null);
  assert.equal(normalizeNotionId('https://www.notion.so/My-Vocabulary'), null);
});

test('truncate keeps the limit', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('abcdefghijklmnop', 10), 'abcdefghi…');
  assert.equal(truncate('abcdefghijklmnop', 10).length, 10);
});
