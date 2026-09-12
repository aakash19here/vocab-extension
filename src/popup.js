/**
 * Quick-add popup: prefilled from whatever is selected on the current page.
 */

import { splitWordAndMeaning, truncate } from './parse.js';
import { clearHistory, getHistory, getPendingWord, getSettings } from './storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  target: $('target'),
  pending: $('pending'),
  pendingWord: $('pending-word'),
  pendingClear: $('pending-clear'),
  word: $('word'),
  meaning: $('meaning'),
  includeSource: $('include-source'),
  sourceTitle: $('source-title'),
  status: $('status'),
  save: $('save'),
  history: $('history'),
  historyEmpty: $('history-empty'),
  clearHistory: $('clear-history'),
  openOptions: $('open-options'),
  openNotion: $('open-notion'),
};

let activeTab = null;

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`;
}

function relativeTime(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  const units = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];
  for (const [suffix, size] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix}`;
  }
  return 'now';
}

async function loadTarget() {
  const settings = await getSettings();
  const dot = el.target.querySelector('.dot');
  const label = el.target.querySelector('span');

  if (!settings.token || !settings.targetId) {
    dot.className = 'dot err';
    label.textContent = 'Not connected — open Settings';
    el.openNotion.style.display = 'none';
    return settings;
  }

  dot.className = 'dot ok';
  label.textContent = settings.targetTitle || 'Notion page';
  label.title = settings.targetUrl || '';
  if (settings.targetUrl) {
    el.openNotion.href = settings.targetUrl;
  } else {
    el.openNotion.style.display = 'none';
  }
  return settings;
}

async function loadPending() {
  const pending = await getPendingWord();
  if (!pending) {
    el.pending.classList.remove('show');
    return;
  }
  el.pending.classList.add('show');
  el.pendingWord.textContent = pending.word;
  if (!el.word.value) el.word.value = pending.word;
}

async function loadHistory() {
  const history = await getHistory();
  el.history.replaceChildren();
  el.historyEmpty.style.display = history.length ? 'none' : 'block';

  for (const item of history.slice(0, 12)) {
    const li = document.createElement('li');

    const dot = document.createElement('i');
    dot.className = `dot ${item.status === 'saved' ? 'ok' : 'err'}`;
    dot.title = item.status === 'saved' ? 'Saved' : item.error || 'Failed';

    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = truncate(item.word || item.meaning, 22);

    const meaning = document.createElement('span');
    meaning.className = 'meaning';
    meaning.textContent = item.word ? item.meaning : '';
    meaning.title = item.meaning || '';

    const time = document.createElement('time');
    time.dateTime = item.savedAt;
    time.textContent = relativeTime(item.savedAt);

    li.append(dot, word, meaning, time);
    el.history.append(li);
  }
}

/** Pull the current selection off the page (allowed: clicking the action grants activeTab). */
async function prefillFromSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;

  if (tab && tab.title) {
    el.sourceTitle.textContent = `— ${truncate(tab.title, 28)}`;
  } else {
    el.includeSource.checked = false;
    el.includeSource.closest('.checkbox').style.display = 'none';
  }

  if (!tab || tab.id === undefined || tab.id < 0) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection() ? window.getSelection().toString() : ''),
    });
    const selection = (result && result.result ? result.result : '').trim();
    if (!selection) return;

    const pending = await getPendingWord();
    if (pending) {
      // The word is already stashed, so the selection can only be its meaning.
      el.word.value = pending.word;
      el.meaning.value = selection.replace(/\s+/g, ' ');
      return;
    }
    const { word, meaning } = splitWordAndMeaning(selection);
    el.word.value = word;
    el.meaning.value = meaning;
  } catch {
    // Restricted page — leave the form empty.
  }
}

async function submit() {
  const word = el.word.value.trim();
  const meaning = el.meaning.value.trim();
  if (!word && !meaning) {
    setStatus('Type a word or a meaning first.', 'err');
    el.word.focus();
    return;
  }

  el.save.disabled = true;
  setStatus('Saving…', 'busy');

  const useSource = el.includeSource.checked && activeTab;
  const response = await chrome.runtime.sendMessage({
    type: 'save',
    entry: {
      word,
      meaning,
      sourceUrl: useSource ? activeTab.url || '' : '',
      sourceTitle: useSource ? activeTab.title || '' : '',
    },
  });

  el.save.disabled = false;

  if (response && response.ok) {
    el.word.value = '';
    el.meaning.value = '';
    setStatus('Saved ✓', 'ok');
    await Promise.all([loadPending(), loadHistory()]);
    setTimeout(() => window.close(), 700);
  } else {
    setStatus((response && (response.hint || response.error)) || 'Save failed.', 'err');
    await loadHistory();
  }
}

el.save.addEventListener('click', submit);

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    submit();
  }
});

el.word.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    el.meaning.focus();
  }
});

el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

el.pendingClear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clearPending' });
  await loadPending();
});

el.clearHistory.addEventListener('click', async () => {
  await clearHistory();
  await loadHistory();
});

(async function init() {
  const settings = await loadTarget();
  await loadPending();
  await prefillFromSelection();
  await loadHistory();
  if (!settings.token || !settings.targetId) {
    setStatus('Connect Notion in Settings to start saving.', 'err');
  }
  (el.word.value && !el.meaning.value ? el.meaning : el.word).focus();
})();
