/**
 * Drives the real service worker against a stubbed Chrome and a stubbed Notion,
 * exercising the paths a user actually takes through the context menu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installChromeStub, installFetchStub } from './helpers/chrome-stub.mjs';

const TAB = { id: 7, url: 'https://en.wikipedia.org/wiki/Word', title: 'Word - Wikipedia' };

/** Fresh stubs + a fresh copy of the worker for every test. */
async function bootWorker({ selection = '', configured = true } = {}) {
  const stub = installChromeStub({ selection, tab: TAB });
  const requests = installFetchStub([{ status: 200, body: { object: 'list' } }]);

  // Cache-bust so module-level listener registration re-runs per test.
  await import(`../src/background.js?t=${Math.random()}`);

  if (configured) {
    await stub.chrome.storage.local.set({ notionToken: 'secret_x' });
    await stub.chrome.storage.sync.set({
      targetId: 'page-id',
      targetType: 'page',
      targetTitle: 'Vocabulary',
      format: 'bulleted',
      includeSource: true,
      includeDate: true,
      showToast: true,
    });
  }

  await stub.chrome.runtime.onInstalled.emit({ reason: 'update' });
  return { ...stub, requests };
}

const click = (stub, menuItemId, selectionText = '') =>
  stub.chrome.contextMenus.onClicked.emit(
    { menuItemId, selectionText, frameId: 0, pageUrl: TAB.url },
    TAB,
  );

const appendRequests = (requests) => requests.filter((request) => request.url.includes('/children'));

test('the menu is built with the expected items', async () => {
  const stub = await bootWorker();
  const titles = [...stub.menus.values()].map((menu) => menu.title);

  assert.ok(titles.includes('Save to Notion'));
  assert.ok(titles.some((title) => title && title.includes('Save “%s”')));
  assert.ok(titles.some((title) => title && title.includes('as the word')));
  assert.ok(titles.some((title) => title && title.includes('a meaning (pick a word first)')));
  // Every selection menu really is a selection menu.
  for (const menu of stub.menus.values()) {
    assert.deepEqual(menu.contexts, ['selection']);
  }
});

test('a single selection is split and appended to the page', async () => {
  const stub = await bootWorker({ selection: 'ubiquitous — present everywhere' });
  await click(stub, 'vocab-notion-quick', 'ubiquitous — present everywhere');

  const [request] = appendRequests(stub.requests);
  const block = request.body.children[0].bulleted_list_item;
  assert.equal(block.rich_text[0].text.content, 'ubiquitous');
  assert.equal(block.rich_text[0].annotations.bold, true);
  assert.equal(block.rich_text[2].text.content, 'present everywhere');
  assert.equal(block.children[0].paragraph.rich_text[0].text.link.url, TAB.url);
});

test('the full page selection wins over Chrome’s truncated selectionText', async () => {
  const full = `wanderlust — ${'a strong desire to travel '.repeat(60)}`;
  const stub = await bootWorker({ selection: full });
  await click(stub, 'vocab-notion-quick', full.slice(0, 500));

  const [request] = appendRequests(stub.requests);
  const written = request.body.children[0].bulleted_list_item.rich_text
    .map((piece) => piece.text.content)
    .join('');
  assert.ok(written.length > 500);
});

test('word then meaning: two clicks make one entry', async () => {
  const stub = await bootWorker({ selection: 'perspicacious' });
  await click(stub, 'vocab-notion-as-word', 'perspicacious');

  // Nothing is written yet, but the badge and menu say a word is waiting.
  assert.equal(appendRequests(stub.requests).length, 0);
  assert.equal(stub.calls.badges.at(-1), '•');
  assert.match(stub.menus.get('vocab-notion-as-meaning').title, /perspicacious/);
  assert.equal(stub.menus.get('vocab-notion-as-meaning').enabled, true);

  stub.chrome.scripting.executeScript = async ({ args = [] }) => [
    { result: args.length ? undefined : 'having keen insight' },
  ];
  await click(stub, 'vocab-notion-as-meaning', 'having keen insight');

  const [request] = appendRequests(stub.requests);
  const text = request.body.children[0].bulleted_list_item.rich_text
    .map((piece) => piece.text.content)
    .join('');
  assert.equal(text, 'perspicacious — having keen insight');

  // The stash is cleared afterwards, so the next save starts clean.
  const { pendingWord } = await stub.chrome.storage.local.get('pendingWord');
  assert.equal(pendingWord, undefined);
  assert.equal(stub.menus.get('vocab-notion-as-meaning').enabled, false);
});

test('with a word stashed, plain Save treats the selection as the meaning', async () => {
  const stub = await bootWorker({ selection: 'winsome' });
  await click(stub, 'vocab-notion-as-word', 'winsome');

  stub.chrome.scripting.executeScript = async ({ args = [] }) => [
    { result: args.length ? undefined : 'attractive or appealing in appearance' },
  ];
  await click(stub, 'vocab-notion-quick', 'attractive or appealing in appearance');

  const [request] = appendRequests(stub.requests);
  const text = request.body.children[0].bulleted_list_item.rich_text
    .map((piece) => piece.text.content)
    .join('');
  assert.equal(text, 'winsome — attractive or appealing in appearance');
});

test('the stashed word can be forgotten', async () => {
  const stub = await bootWorker({ selection: 'winsome' });
  await click(stub, 'vocab-notion-as-word', 'winsome');
  await click(stub, 'vocab-notion-clear-pending');

  const { pendingWord } = await stub.chrome.storage.local.get('pendingWord');
  assert.equal(pendingWord, undefined);
  assert.equal(stub.calls.badges.at(-1), '');
});

test('saving asks Notion once and records the entry in history', async () => {
  const stub = await bootWorker({ selection: 'lucid — easy to understand' });
  await click(stub, 'vocab-notion-quick', 'lucid — easy to understand');

  const { history } = await stub.chrome.storage.local.get('history');
  assert.equal(history.length, 1);
  assert.equal(history[0].word, 'lucid');
  assert.equal(history[0].status, 'saved');
  assert.equal(history[0].sourceUrl, TAB.url);
});

test('a Notion failure is recorded and surfaced, not swallowed', async () => {
  const stub = await bootWorker({ selection: 'quixotic — idealistic' });
  installFetchStub([{ status: 404, body: { code: 'object_not_found', message: 'Not found.' } }]);
  await click(stub, 'vocab-notion-quick', 'quixotic — idealistic');

  const { history } = await stub.chrome.storage.local.get('history');
  assert.equal(history[0].status, 'failed');
  assert.equal(stub.calls.badges.at(-1), '!');

  // The user is told, via the toast injected into the page.
  const toast = stub.calls.executed.at(-1);
  assert.match(toast.args[0].title, /Could not save/);
  assert.equal(toast.args[0].tone, 'error');
});

test('an unconfigured extension opens options instead of failing quietly', async () => {
  const stub = await bootWorker({ selection: 'anything', configured: false });
  await click(stub, 'vocab-notion-quick', 'anything');

  assert.equal(stub.requests.length, 0);
  assert.equal(stub.calls.openedOptions, 1);
});

test('an empty selection never reaches Notion', async () => {
  const stub = await bootWorker({ selection: '   ' });
  await click(stub, 'vocab-notion-quick', '');
  assert.equal(stub.requests.length, 0);
});

test('the popup can save through the same path', async () => {
  const stub = await bootWorker();
  const response = await new Promise((resolve) => {
    stub.chrome.runtime.onMessage.emit(
      {
        type: 'save',
        entry: { word: 'ersatz', meaning: 'a poor substitute', sourceUrl: TAB.url },
      },
      {},
      resolve,
    );
  });

  assert.equal(response.ok, true);
  const [request] = appendRequests(stub.requests);
  assert.equal(request.body.children[0].bulleted_list_item.rich_text[0].text.content, 'ersatz');
});
