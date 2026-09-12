/**
 * Settings + history persistence.
 *
 * Preferences live in `chrome.storage.sync` so they follow the Chrome profile.
 * The integration token deliberately stays in `chrome.storage.local`: sync data
 * leaves the machine, and a Notion secret should not.
 */

export const DEFAULT_SETTINGS = {
  targetId: '',
  targetType: 'auto', // 'auto' | 'page' | 'database'
  targetTitle: '',
  targetUrl: '',
  format: 'bulleted', // 'bulleted' | 'toggle' | 'paragraph'
  includeSource: true,
  includeDate: true,
  showToast: true,
  showNotifications: false,
};

const SYNC_KEYS = Object.keys(DEFAULT_SETTINGS);

const LOCAL_KEYS = {
  token: 'notionToken',
  schema: 'targetProperties',
  history: 'history',
  pending: 'pendingWord',
};

export const HISTORY_LIMIT = 25;
/** A stashed word is forgotten after this long so it cannot surprise you later. */
export const PENDING_TTL_MS = 30 * 60 * 1000;

export async function getSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_KEYS),
    chrome.storage.local.get([LOCAL_KEYS.token, LOCAL_KEYS.schema]),
  ]);
  return {
    ...DEFAULT_SETTINGS,
    ...sync,
    token: local[LOCAL_KEYS.token] || '',
    targetProperties: local[LOCAL_KEYS.schema] || null,
  };
}

export async function saveSettings(patch) {
  const sync = {};
  for (const key of SYNC_KEYS) {
    if (key in patch) sync[key] = patch[key];
  }
  const local = {};
  if ('token' in patch) local[LOCAL_KEYS.token] = patch.token;
  if ('targetProperties' in patch) local[LOCAL_KEYS.schema] = patch.targetProperties;

  await Promise.all([
    Object.keys(sync).length ? chrome.storage.sync.set(sync) : null,
    Object.keys(local).length ? chrome.storage.local.set(local) : null,
  ]);
}

export async function isConfigured() {
  const settings = await getSettings();
  return Boolean(settings.token && settings.targetId);
}

/* ---------------------------------------------------------------- */
/* Recent saves                                                      */
/* ---------------------------------------------------------------- */

export async function getHistory() {
  const { [LOCAL_KEYS.history]: history } = await chrome.storage.local.get(LOCAL_KEYS.history);
  return Array.isArray(history) ? history : [];
}

export async function addHistoryEntry(entry) {
  const history = await getHistory();
  const next = [entry, ...history].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({ [LOCAL_KEYS.history]: next });
  return next;
}

export async function clearHistory() {
  await chrome.storage.local.set({ [LOCAL_KEYS.history]: [] });
}

/* ---------------------------------------------------------------- */
/* The word waiting for its meaning                                  */
/* ---------------------------------------------------------------- */

export async function getPendingWord() {
  const { [LOCAL_KEYS.pending]: pending } = await chrome.storage.local.get(LOCAL_KEYS.pending);
  if (!pending || !pending.word) return null;
  if (Date.now() - (pending.stashedAt || 0) > PENDING_TTL_MS) {
    await clearPendingWord();
    return null;
  }
  return pending;
}

export async function setPendingWord(pending) {
  await chrome.storage.local.set({
    [LOCAL_KEYS.pending]: { ...pending, stashedAt: Date.now() },
  });
}

export async function clearPendingWord() {
  await chrome.storage.local.remove(LOCAL_KEYS.pending);
}
