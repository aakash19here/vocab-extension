/**
 * Just enough of the `chrome.*` surface to import and drive the service worker
 * from plain Node.
 */

function area() {
  const data = new Map();
  const asArray = (keys) => (Array.isArray(keys) ? keys : [keys]);
  return {
    data,
    async get(keys) {
      if (keys === null || keys === undefined) return Object.fromEntries(data);
      const out = {};
      for (const key of asArray(keys)) {
        if (data.has(key)) out[key] = data.get(key);
      }
      return out;
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(keys) {
      for (const key of asArray(keys)) data.delete(key);
    },
    async clear() {
      data.clear();
    },
  };
}

function event() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    async emit(...args) {
      for (const fn of listeners) await fn(...args);
    },
  };
}

export function installChromeStub({ selection = '', tab = {} } = {}) {
  const menus = new Map();
  const calls = { notifications: [], badges: [], executed: [], openedOptions: 0 };

  const chrome = {
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      getURL: (path) => `chrome-extension://stub/${path}`,
      openOptionsPage: () => {
        calls.openedOptions += 1;
      },
      lastError: null,
    },
    storage: { local: area(), sync: area(), onChanged: event() },
    contextMenus: {
      onClicked: event(),
      async removeAll() {
        menus.clear();
      },
      create(properties) {
        menus.set(properties.id, { ...properties });
        return properties.id;
      },
      async update(id, properties) {
        if (!menus.has(id)) throw new Error(`no menu ${id}`);
        Object.assign(menus.get(id), properties);
      },
    },
    action: {
      async setBadgeText({ text }) {
        calls.badges.push(text);
      },
      async setBadgeBackgroundColor() {},
      async setTitle() {},
    },
    scripting: {
      async executeScript({ func, args = [] }) {
        calls.executed.push({ func, args });
        // The selection reader runs in the page; the toast renderer does not.
        return [{ result: args.length ? undefined : selection }];
      },
    },
    notifications: {
      create(options) {
        calls.notifications.push(options);
      },
    },
    tabs: {
      async query() {
        return [tab];
      },
    },
  };

  globalThis.chrome = chrome;
  return { chrome, menus, calls };
}

/** Records every request and replies from a queue of canned responses. */
export function installFetchStub(responses = []) {
  const requests = [];
  const queue = [...responses];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    });
    const next = queue.shift() || { status: 200, body: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body ?? {}),
    };
  };
  return requests;
}
