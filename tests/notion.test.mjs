import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NotionError,
  buildBlocks,
  buildDatabaseProperties,
  resolveTarget,
  saveEntry,
} from '../src/notion.js';
import { installFetchStub } from './helpers/chrome-stub.mjs';

const ENTRY = {
  word: 'ubiquitous',
  meaning: 'present, appearing, or found everywhere',
  sourceUrl: 'https://www.dictionary.com/browse/ubiquitous',
  sourceTitle: 'Dictionary.com',
  savedAt: '2026-09-12T10:00:00.000Z',
};

const flatten = (richText) => richText.map((piece) => piece.text.content).join('');

test('a bulleted entry carries the word in bold and the source underneath', () => {
  const [block] = buildBlocks(ENTRY, { format: 'bulleted' });
  assert.equal(block.type, 'bulleted_list_item');

  const text = block.bulleted_list_item.rich_text;
  assert.equal(text[0].text.content, 'ubiquitous');
  assert.equal(text[0].annotations.bold, true);
  assert.equal(flatten(text), 'ubiquitous — present, appearing, or found everywhere');

  const [source] = block.bulleted_list_item.children;
  assert.equal(source.paragraph.rich_text[0].text.link.url, ENTRY.sourceUrl);
  assert.match(flatten(source.paragraph.rich_text), /Dictionary\.com · /);
});

test('the source line can be turned off entirely', () => {
  const [block] = buildBlocks(ENTRY, {
    format: 'bulleted',
    includeSource: false,
    includeDate: false,
  });
  assert.equal(block.bulleted_list_item.children, undefined);
});

test('a toggle entry hides the meaning inside the block', () => {
  const [block] = buildBlocks(ENTRY, { format: 'toggle' });
  assert.equal(block.type, 'toggle');
  assert.equal(flatten(block.toggle.rich_text), 'ubiquitous');
  assert.equal(flatten(block.toggle.children[0].paragraph.rich_text), ENTRY.meaning);
});

test('a paragraph entry puts the source in its own block', () => {
  const blocks = buildBlocks(ENTRY, { format: 'paragraph' });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[1].paragraph.rich_text[0].annotations.italic, true);
});

test('a word with no meaning still produces a block', () => {
  const [block] = buildBlocks({ word: 'quixotic' }, { includeSource: false, includeDate: false });
  assert.equal(flatten(block.bulleted_list_item.rich_text), 'quixotic');
});

test('long meanings are chunked under the 2000 character limit', () => {
  const [block] = buildBlocks({ word: 'x', meaning: 'a'.repeat(4500) }, { includeDate: false });
  const pieces = block.bulleted_list_item.rich_text;
  assert.ok(pieces.every((piece) => piece.text.content.length <= 2000));
  assert.equal(flatten(pieces), `x — ${'a'.repeat(4500)}`);
});

test('a bad source URL does not break the block', () => {
  const [block] = buildBlocks({ ...ENTRY, sourceUrl: 'not a url', sourceTitle: '' });
  assert.ok(block.bulleted_list_item.children === undefined || block.bulleted_list_item.children.length);
});

test('database properties map onto a conventional schema', () => {
  const schema = {
    Word: { type: 'title' },
    Meaning: { type: 'rich_text' },
    Context: { type: 'rich_text' },
    Source: { type: 'url' },
    Added: { type: 'date' },
    Tags: { type: 'multi_select' },
  };
  const properties = buildDatabaseProperties(ENTRY, schema);

  assert.equal(properties.Word.title[0].text.content, 'ubiquitous');
  assert.equal(properties.Meaning.rich_text[0].text.content, ENTRY.meaning);
  assert.equal(properties.Source.url, ENTRY.sourceUrl);
  assert.equal(properties.Added.date.start, '2026-09-12');
  assert.equal('Context' in properties, false);
  assert.equal('Tags' in properties, false);
});

test('database properties fall back when names differ', () => {
  const properties = buildDatabaseProperties(ENTRY, {
    Name: { type: 'title' },
    Notes: { type: 'rich_text' },
  });
  assert.equal(properties.Name.title[0].text.content, 'ubiquitous');
  assert.equal(properties.Notes.rich_text[0].text.content, ENTRY.meaning);
});

test('saveEntry appends blocks to a page', async () => {
  const requests = installFetchStub([{ status: 200, body: { object: 'list' } }]);
  await saveEntry(
    { token: 'secret_x', targetId: 'page-id', targetType: 'page', format: 'bulleted' },
    ENTRY,
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.notion.com/v1/blocks/page-id/children');
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].headers.Authorization, 'Bearer secret_x');
  assert.equal(requests[0].headers['Notion-Version'], '2022-06-28');
  assert.equal(requests[0].body.children[0].type, 'bulleted_list_item');
});

test('saveEntry creates a row when the target is a database', async () => {
  const requests = installFetchStub([{ status: 200, body: { url: 'https://notion.so/new-row' } }]);
  const result = await saveEntry(
    {
      token: 'secret_x',
      targetId: 'db-id',
      targetType: 'database',
      targetProperties: { Word: { type: 'title' }, Meaning: { type: 'rich_text' } },
    },
    ENTRY,
  );

  assert.equal(requests[0].url, 'https://api.notion.com/v1/pages');
  assert.equal(requests[0].body.parent.database_id, 'db-id');
  assert.equal(requests[0].body.properties.Word.title[0].text.content, 'ubiquitous');
  assert.equal(requests[0].body.children, undefined);
  assert.equal(result.url, 'https://notion.so/new-row');
});

test('a database with no text property keeps the meaning in the page body', async () => {
  const requests = installFetchStub([{ status: 200, body: {} }]);
  await saveEntry(
    {
      token: 'secret_x',
      targetId: 'db-id',
      targetType: 'database',
      targetProperties: { Word: { type: 'title' } },
    },
    ENTRY,
  );
  assert.equal(requests[0].body.children.length, 1);
});

test('an unknown target type is resolved before writing', async () => {
  const requests = installFetchStub([
    { status: 404, body: { code: 'object_not_found', message: 'nope' } }, // not a database
    { status: 200, body: { id: 'page-id', properties: {} } }, //             …so a page
    { status: 200, body: {} }, //                                            the append
  ]);
  await saveEntry({ token: 'secret_x', targetId: 'page-id', targetType: 'auto' }, ENTRY);

  assert.deepEqual(
    requests.map((request) => request.url),
    [
      'https://api.notion.com/v1/databases/page-id',
      'https://api.notion.com/v1/pages/page-id',
      'https://api.notion.com/v1/blocks/page-id/children',
    ],
  );
});

test('resolveTarget reports a database with its schema', async () => {
  installFetchStub([
    {
      status: 200,
      body: {
        id: 'db-id',
        title: [{ plain_text: 'Vocabulary' }],
        url: 'https://notion.so/db',
        properties: { Word: { type: 'title' } },
      },
    },
  ]);
  const target = await resolveTarget('secret_x', 'db-id');
  assert.equal(target.type, 'database');
  assert.equal(target.title, 'Vocabulary');
  assert.equal(target.properties.Word.type, 'title');
});

test('API errors surface a helpful hint', async () => {
  installFetchStub([{ status: 401, body: { code: 'unauthorized', message: 'API token is invalid.' } }]);
  await assert.rejects(
    saveEntry({ token: 'bad', targetId: 'page-id', targetType: 'page' }, ENTRY),
    (error) => {
      assert.ok(error instanceof NotionError);
      assert.equal(error.status, 401);
      assert.match(error.hint, /integration token was rejected/i);
      return true;
    },
  );
});

test('a missing token or target fails before any request', async () => {
  const requests = installFetchStub([]);
  await assert.rejects(saveEntry({ token: '', targetId: 'page-id' }, ENTRY), /No Notion token/);
  await assert.rejects(saveEntry({ token: 'secret_x', targetId: '' }, ENTRY), /No Notion page/);
  assert.equal(requests.length, 0);
});

test('network failures are reported as such', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(
    saveEntry({ token: 'secret_x', targetId: 'page-id', targetType: 'page' }, ENTRY),
    /Could not reach Notion/,
  );
});
