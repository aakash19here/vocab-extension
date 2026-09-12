/**
 * Options page: token, destination, formatting. Everything autosaves.
 */

import { normalizeNotionId } from './parse.js';
import { resolveTarget, whoAmI } from './notion.js';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from './storage.js';

const $ = (id) => document.getElementById(id);

const el = {
  token: $('token'),
  toggleToken: $('toggle-token'),
  checkToken: $('check-token'),
  tokenStatus: $('token-status'),
  target: $('target'),
  checkTarget: $('check-target'),
  targetStatus: $('target-status'),
  includeSource: $('include-source'),
  includeDate: $('include-date'),
  showToast: $('show-toast'),
  showNotifications: $('show-notifications'),
  preview: $('preview'),
  saveStatus: $('save-status'),
  reset: $('reset'),
};

const formatInputs = [...document.querySelectorAll('input[name="format"]')];

function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.className = `status ${kind}`;
}

let flashTimer;
function flashSaved() {
  setStatus(el.saveStatus, 'Settings saved', 'ok');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => setStatus(el.saveStatus, ''), 1600);
}

function selectedFormat() {
  const checked = formatInputs.find((input) => input.checked);
  return checked ? checked.value : DEFAULT_SETTINGS.format;
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

function renderPreview() {
  const format = selectedFormat();
  const source = [];
  if (el.includeSource.checked) source.push('dictionary.com');
  if (el.includeDate.checked) {
    source.push(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  }

  el.preview.replaceChildren();

  const line = document.createElement('div');
  line.className = 'line';

  const marker = document.createElement('span');
  marker.className = 'caret';
  if (format === 'bulleted') marker.textContent = '•';
  if (format === 'toggle') marker.textContent = '▸';
  if (marker.textContent) line.append(marker);

  const body = document.createElement('div');
  const word = document.createElement('b');
  word.textContent = 'ubiquitous';
  body.append(word);

  if (format === 'toggle') {
    const hidden = document.createElement('div');
    hidden.className = 'muted';
    hidden.style.marginTop = '3px';
    hidden.textContent = 'present, appearing, or found everywhere';
    body.append(hidden);
  } else {
    body.append(document.createTextNode(' — present, appearing, or found everywhere'));
  }

  if (source.length) {
    const src = document.createElement('div');
    src.className = 'src';
    src.textContent = source.join(' · ');
    body.append(src);
  }

  line.append(body);
  el.preview.append(line);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

async function persistPreferences() {
  await saveSettings({
    format: selectedFormat(),
    includeSource: el.includeSource.checked,
    includeDate: el.includeDate.checked,
    showToast: el.showToast.checked,
    showNotifications: el.showNotifications.checked,
  });
  renderPreview();
  flashSaved();
}

let tokenTimer;
el.token.addEventListener('input', () => {
  clearTimeout(tokenTimer);
  setStatus(el.tokenStatus, '');
  tokenTimer = setTimeout(async () => {
    await saveSettings({ token: el.token.value.trim() });
    flashSaved();
  }, 400);
});

el.toggleToken.addEventListener('click', () => {
  const hidden = el.token.type === 'password';
  el.token.type = hidden ? 'text' : 'password';
  el.toggleToken.textContent = hidden ? 'Hide' : 'Show';
});

el.checkToken.addEventListener('click', async () => {
  const token = el.token.value.trim();
  if (!token) {
    setStatus(el.tokenStatus, 'Paste your integration secret first.', 'err');
    return;
  }
  await saveSettings({ token });
  setStatus(el.tokenStatus, 'Checking…', 'busy');
  el.checkToken.disabled = true;
  try {
    const me = await whoAmI(token);
    setStatus(
      el.tokenStatus,
      `Connected as “${me.name}”${me.workspace ? ` in ${me.workspace}` : ''}.`,
      'ok',
    );
  } catch (error) {
    setStatus(el.tokenStatus, error.hint || error.message, 'err');
  } finally {
    el.checkToken.disabled = false;
  }
});

let targetTimer;
el.target.addEventListener('input', () => {
  clearTimeout(targetTimer);
  setStatus(el.targetStatus, '');
  targetTimer = setTimeout(async () => {
    const id = normalizeNotionId(el.target.value);
    if (!id && el.target.value.trim()) {
      setStatus(el.targetStatus, 'That does not look like a Notion link or id.', 'err');
      return;
    }
    // The id changed, so anything we knew about the old destination is stale.
    await saveSettings({
      targetId: id || '',
      targetType: 'auto',
      targetTitle: '',
      targetUrl: '',
      targetProperties: null,
    });
    flashSaved();
  }, 400);
});

el.checkTarget.addEventListener('click', async () => {
  const token = el.token.value.trim();
  const id = normalizeNotionId(el.target.value);
  if (!token) {
    setStatus(el.targetStatus, 'Add your integration token first (step 1).', 'err');
    return;
  }
  if (!id) {
    setStatus(el.targetStatus, 'Paste the link to a Notion page or database.', 'err');
    return;
  }

  setStatus(el.targetStatus, 'Checking…', 'busy');
  el.checkTarget.disabled = true;
  try {
    const target = await resolveTarget(token, id);
    await saveSettings({
      targetId: target.id,
      targetType: target.type,
      targetTitle: target.title,
      targetUrl: target.url || '',
      targetProperties: target.properties || null,
    });
    setStatus(
      el.targetStatus,
      target.type === 'database'
        ? `Ready — new rows go into the “${target.title}” database.`
        : `Ready — words are appended to the “${target.title}” page.`,
      'ok',
    );
  } catch (error) {
    setStatus(el.targetStatus, error.hint || error.message, 'err');
  } finally {
    el.checkTarget.disabled = false;
  }
});

for (const input of [...formatInputs, el.includeSource, el.includeDate, el.showToast, el.showNotifications]) {
  input.addEventListener('change', persistPreferences);
}

el.reset.addEventListener('click', async () => {
  if (!confirm('Clear the saved token, destination, preferences and history?')) return;
  await chrome.storage.local.clear();
  await chrome.storage.sync.clear();
  location.reload();
});

/* ------------------------------------------------------------------ */

(async function init() {
  const settings = await getSettings();
  el.token.value = settings.token;
  el.target.value = settings.targetUrl || settings.targetId;
  el.includeSource.checked = settings.includeSource;
  el.includeDate.checked = settings.includeDate;
  el.showToast.checked = settings.showToast;
  el.showNotifications.checked = settings.showNotifications;
  for (const input of formatInputs) input.checked = input.value === settings.format;

  if (settings.targetTitle) {
    setStatus(
      el.targetStatus,
      settings.targetType === 'database'
        ? `Saving rows into the “${settings.targetTitle}” database.`
        : `Appending to the “${settings.targetTitle}” page.`,
      'ok',
    );
  }
  renderPreview();

  if (!settings.token) el.token.focus();
})();
