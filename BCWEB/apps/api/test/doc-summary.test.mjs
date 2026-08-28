// The link-preview card's summary, and the one stripper it shares with search.
//
// The card has had a `desc` slot since it was written and nothing ever filled it, so every
// preview was a title over a category — two links to two different pages produced two cards
// that differed by one line of text.
//
// It is derived from the page body rather than stored on the model, because a `desc` column is
// a second thing to keep in step with the page it describes, and it would be wrong the first
// time somebody rewrote an opening paragraph without remembering it existed.
//
// The stripper is shared with the search snippets. Two strippers would show `:::tip[Careful]`
// as a summary on one screen and not the other, and the one that is wrong is whichever you
// did not happen to test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripMd, summarise } from '../src/routes/docs.mjs';

test('doc directives never reach the reader as syntax', () => {
  const md = ':::tip[Careful]\nDo **not** delete `repo.json`.\n:::';
  const out = stripMd(md);
  assert.equal(out.includes(':::'), false, out);
  assert.equal(out.includes('**'), false, out);
  assert.equal(out.includes('`'), false, out);
  assert.equal(out.includes('not delete'), true, out);
});

test('a badge with attributes leaves no braces behind', () => {
  // `:badge[New]{color="#0a7"}` — the attribute block is the part a naive strip leaves as
  // `{color="#0a7"}`, which reads as broken text rather than as markup.
  const out = stripMd(':badge[New]{color="#0a7"} Something happened.');
  assert.equal(/[{}]/.test(out), false, out);
  assert.equal(out.includes('Something happened.'), true, out);
});

test('a table does not become a wall of pipes', () => {
  const out = stripMd('| Field | Meaning |\n|---|---|\n| id | the id |');
  assert.equal(out.includes('|'), false, out);
  assert.equal(out.includes('---'), false, out);
});

test('a short page is its whole first line, with no ellipsis', () => {
  const s = summarise('Just a sentence.');
  assert.equal(s, 'Just a sentence.');
  assert.equal(s.endsWith('…'), false);
});

test('a long page is cut on a word and says it was cut', () => {
  const body = `${'alpha bravo charlie delta echo foxtrot '.repeat(20)}end`;
  const s = summarise(body, 140);
  assert.equal(s.length <= 141, true, `${s.length}`);
  assert.equal(s.endsWith('…'), true, s);
  // Cut BETWEEN words, which is the whole point of looking for a space: what precedes the
  // ellipsis must be a PREFIX of the body ending at a word boundary. A plain slice(0, 140)
  // passes a length check and still reads as broken — "alpha bravo charl…".
  //
  // My first attempt at this assertion was a regex on the last character, which asserts
  // nothing: the last character before the ellipsis is a letter in both the right answer and
  // the wrong one. Comparing against the source is what actually distinguishes them.
  const kept = s.slice(0, -1);
  assert.equal(body.startsWith(kept), true, `not a prefix of the body: ${kept.slice(-40)}`);
  assert.equal(body[kept.length] === ' ' || body.length === kept.length, true,
    `cut mid-word before ${JSON.stringify(body.slice(kept.length, kept.length + 6))}`);
});

test('an empty or absent body summarises to nothing, not to "undefined"', () => {
  assert.equal(summarise(''), '');
  assert.equal(summarise(null), '');
  assert.equal(summarise(undefined), '');
});
