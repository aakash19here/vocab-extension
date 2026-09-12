/**
 * Service worker: context menus, saving, and the little in-page toast.
 */

import { splitWordAndMeaning, truncate } from './parse.js';
import { saveEntry } from './notion.js';
import {
  addHistoryEntry,
  clearPendingWord,
  getPendingWord,
  getSettings,
  setPendingWord,
} from './storage.js';

const MENU = {
  root: 'vocab-notion-root',
  quick: 'vocab-notion-quick',
  asWord: 'vocab-notion-as-word',
  asMeaning: 'vocab-notion-as-meaning',
  clearPending: 'vocab-notion-clear-pending',
  options: 'vocab-notion-options',
};

/* ------------------------------------------------------------------ */
/* Context menus                                                       */
/* ------------------------------------------------------------------ */

async function buildMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU.root,
    title: 'Save to Notion',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: MENU.quick,
    parentId: MENU.root,
    title: 'Save “%s”',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: MENU.asWord,
    parentId: MENU.root,
    title: 'Use “%s” as the word',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: MENU.asMeaning,
    parentId: MENU.root,
    title: 'Save “%s” as the meaning',
    contexts: ['selection'],
    enabled: false,
  });
  chrome.contextMenus.create({
    id: MENU.clearPending,
    parentId: MENU.root,
    title: 'Forget the stashed word',
    contexts: ['selection'],
    visible: false,
  });
  chrome.contextMenus.create({
    id: `${MENU.root}-sep`,
    parentId: MENU.root,
    type: 'separator',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: MENU.options,
    parentId: MENU.root,
    title: 'Vocab → Notion settings…',
    contexts: ['selection'],
  });

  await refreshMenuState();
}

/**
 * Reflect the stashed word in the menu labels and the toolbar badge, so you can
 * see at a glance that a word is waiting for its meaning.
 */
async function refreshMenuState() {
  const pending = await getPendingWord();
  const label = pending ? truncate(pending.word, 28) : '';

  await Promise.all([
    updateMenu(MENU.asMeaning, {
      title: pending ? `Save “%s” as the meaning of “${label}”` : 'Save “%s” as a meaning (pick a word first)',
      enabled: Boolean(pending),
    }),
    updateMenu(MENU.asWord, {
      title: pending ? 'Use “%s” as the word instead' : 'Use “%s” as the word',
    }),
    updateMenu(MENU.clearPending, {
      title: pending ? `Forget “${label}”` : 'Forget the stashed word',
      visible: Boolean(pending),
    }),
  ]);

  await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
  await chrome.action.setBadgeText({ text: pending ? '•' : '' });
  await chrome.action.setTitle({
    title: pending ? `Vocab → Notion — waiting for the meaning of “${label}”` : 'Vocab → Notion',
  });
}

/** Menus may not exist yet after a cold worker start — never let that throw. */
async function updateMenu(id, properties) {
  try {
    await chrome.contextMenus.update(id, properties);
  } catch {
    /* rebuilt on the next install/startup */
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await buildMenus();
  const { token, targetId } = await getSettings();
  if (details.reason === 'install' && (!token || !targetId)) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  buildMenus();
});

/* ------------------------------------------------------------------ */
/* Reading the selection                                               */
/* ------------------------------------------------------------------ */

/**
 * `info.selectionText` is collapsed and truncated by Chrome, so ask the page
 * for the real selection first. `activeTab` is granted by the menu click, which
 * is why this works without broad host permissions.
 */
async function readSelection(tab, info) {
  const fallback = (info.selectionText || '').trim();
  if (!tab || tab.id === undefined || tab.id < 0) return fallback;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: () => (window.getSelection() ? window.getSelection().toString() : ''),
    });
    const text = (result && result.result ? result.result : '').trim();
    return text.length >= fallback.length ? text : fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

/** Injected into the page. Must be fully self-contained. */
function renderToast({ title, body, tone, duration }) {
  const HOST_ID = '__vocab_notion_toast__';
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
  const shadow = host.attachShadow({ mode: 'open' });

  const accent = tone === 'error' ? '#ef4444' : tone === 'pending' ? '#f59e0b' : '#22c55e';
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        display: flex; gap: 10px; align-items: flex-start;
        max-width: 320px; padding: 12px 14px;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: #f8fafc; background: #1e293b;
        border-radius: 10px; border-left: 3px solid ${accent};
        box-shadow: 0 10px 30px rgba(2, 6, 23, .35);
        animation: slide .18s ease-out;
      }
      .dot { width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: ${accent}; flex: none; }
      .title { font-weight: 600; }
      .body { margin-top: 2px; color: #cbd5e1; word-break: break-word; }
      @keyframes slide { from { opacity: 0; transform: translateY(8px); } }
      @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    </style>
    <div class="card">
      <div class="dot"></div>
      <div>
        <div class="title"></div>
        <div class="body"></div>
      </div>
    </div>`;

  shadow.querySelector('.title').textContent = title;
  const bodyNode = shadow.querySelector('.body');
  bodyNode.textContent = body || '';
  if (!body) bodyNode.style.display = 'none';

  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), duration || 3200);
}

async function notify(tab, { title, body, tone = 'success' }) {
  const settings = await getSettings();
  const duration = tone === 'error' ? 6000 : 3200;
  let shown = false;

  if (settings.showToast && tab && tab.id !== undefined && tab.id >= 0) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: renderToast,
        args: [{ title, body, tone, duration }],
      });
      shown = true;
    } catch {
      shown = false; // chrome:// pages, the Web Store, PDFs…
    }
  }

  if (settings.showNotifications || !shown) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: body || '',
    });
  }
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(refreshMenuState, 2500);
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

/**
 * Send one entry to Notion, record it, and tell the user what happened.
 * @returns {Promise<{ok: boolean, error?: string, hint?: string, url?: string}>}
 */
async function save(entry, tab) {
  const settings = await getSettings();

  if (!settings.token || !settings.targetId) {
    await notify(tab, {
      title: 'Connect Notion first',
      body: 'Opening settings so you can paste your token and page link.',
      tone: 'error',
    });
    chrome.runtime.openOptionsPage();
    return { ok: false, error: 'not_configured' };
  }

  const record = {
    word: (entry.word || '').trim(),
    meaning: (entry.meaning || '').trim(),
    sourceUrl: entry.sourceUrl || '',
    sourceTitle: entry.sourceTitle || '',
    savedAt: new Date().toISOString(),
  };

  if (!record.word && !record.meaning) {
    await notify(tab, { title: 'Nothing to save', body: 'Select some text first.', tone: 'error' });
    return { ok: false, error: 'empty' };
  }

  try {
    const result = await saveEntry(settings, record);
    await addHistoryEntry({ ...record, status: 'saved', url: result.url || settings.targetUrl || '' });
    await flashBadge('✓', '#16a34a');
    await notify(tab, {
      title: record.word ? `Saved “${truncate(record.word, 40)}”` : 'Saved to Notion',
      body: record.meaning
        ? truncate(record.meaning, 90)
        : `Added to ${settings.targetTitle || 'your Notion page'}`,
    });
    return { ok: true, url: result.url };
  } catch (error) {
    await addHistoryEntry({ ...record, status: 'failed', error: error.message || String(error) });
    await flashBadge('!', '#dc2626');
    await notify(tab, {
      title: 'Could not save to Notion',
      body: error.hint || error.message || String(error),
      tone: 'error',
    });
    return { ok: false, error: error.message || String(error), hint: error.hint || '' };
  }
}

/* ------------------------------------------------------------------ */
/* Menu clicks                                                         */
/* ------------------------------------------------------------------ */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU.options) {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (info.menuItemId === MENU.clearPending) {
    await clearPendingWord();
    await refreshMenuState();
    await notify(tab, { title: 'Stashed word forgotten', tone: 'pending' });
    return;
  }

  const selection = await readSelection(tab, info);
  if (!selection) {
    await notify(tab, { title: 'Nothing selected', tone: 'error' });
    return;
  }

  const source = {
    sourceUrl: (tab && tab.url) || info.pageUrl || '',
    sourceTitle: (tab && tab.title) || '',
  };

  switch (info.menuItemId) {
    case MENU.quick: {
      const pending = await getPendingWord();
      if (pending) {
        // A word is already stashed — treat this selection as its meaning.
        await clearPendingWord();
        await refreshMenuState();
        await save(
          {
            word: pending.word,
            meaning: selection,
            sourceUrl: pending.sourceUrl || source.sourceUrl,
            sourceTitle: pending.sourceTitle || source.sourceTitle,
          },
          tab,
        );
        return;
      }
      const { word, meaning } = splitWordAndMeaning(selection);
      await save({ word, meaning, ...source }, tab);
      return;
    }

    case MENU.asWord: {
      const { word } = splitWordAndMeaning(selection);
      const headword = word || selection.trim();
      await setPendingWord({ word: headword, ...source });
      await refreshMenuState();
      await notify(tab, {
        title: `“${truncate(headword, 40)}” stashed`,
        body: 'Now select its meaning and pick “Save as the meaning”.',
        tone: 'pending',
      });
      return;
    }

    case MENU.asMeaning: {
      const pending = await getPendingWord();
      if (!pending) {
        await notify(tab, {
          title: 'No word stashed',
          body: 'Select the word first and choose “Use as the word”.',
          tone: 'error',
        });
        await refreshMenuState();
        return;
      }
      await clearPendingWord();
      await refreshMenuState();
      await save(
        {
          word: pending.word,
          meaning: selection,
          sourceUrl: pending.sourceUrl || source.sourceUrl,
          sourceTitle: pending.sourceTitle || source.sourceTitle,
        },
        tab,
      );
      return;
    }

    default:
      break;
  }
});

/* ------------------------------------------------------------------ */
/* Messages from the popup                                             */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  switch (message.type) {
    case 'save':
      (async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        sendResponse(await save(message.entry || {}, tab));
      })();
      return true;

    case 'clearPending':
      (async () => {
        await clearPendingWord();
        await refreshMenuState();
        sendResponse({ ok: true });
      })();
      return true;

    case 'refreshMenus':
      (async () => {
        await refreshMenuState();
        sendResponse({ ok: true });
      })();
      return true;

    default:
      return undefined;
  }
});

// Keep badge and labels honest after settings or pending-word changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'pendingWord' in changes) refreshMenuState();
});
