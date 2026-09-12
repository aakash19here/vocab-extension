# Vocab → Notion

A Chrome extension for building a vocabulary list without leaving the page you are reading.
Select a word (and its meaning), right-click → **Save to Notion**, and it is appended to your
Notion page.

```
•  ubiquitous — present, appearing, or found everywhere
   Dictionary.com · Sep 12, 2026
```

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. The options page opens on first install — fill in the two steps below.

Pin the extension (puzzle icon → pin) if you want the quick-add popup handy.

## Connect Notion

**1. Create an integration**

- Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**.
- Name it (e.g. "Vocab"), pick your workspace, create it.
- Copy the **Internal Integration Secret** (`ntn_…`) and paste it into the extension's options.

**2. Pick where words go**

- Open (or create) the Notion page you want to collect words in.
- In that page: **•••** → **Connections** → add the integration you just made. Without this step
  Notion will not let the extension see the page.
- **•••** → **Copy link**, paste the link into the extension's options, and hit **Check**.

Both steps have a **Check** button that tells you exactly what is wrong if something is off.

## Using it

| What you do | What happens |
| --- | --- |
| Select `word — meaning`, right-click → **Save to Notion** → **Save "…"** | Split into word + meaning and appended |
| Select just the word → **Use "…" as the word** | The word is stashed (the toolbar icon shows a dot) |
| …then select the meaning → **Save "…" as the meaning of "word"** | Both are saved together as one entry |
| Click the toolbar icon (or ⌘⇧Y / Ctrl+Shift+Y) | Quick-add popup, prefilled from the current selection, editable before saving |

The stashed word is the useful one for Google's dictionary card: the word and its definition are
never one tidy selection, so grab them in two passes. It expires after 30 minutes.

A small confirmation appears in the corner of the page after each save, and the popup keeps a list
of the last 25 entries so you can tell at a glance whether anything failed.

### Saving into a database instead

Paste a database link instead of a page link and each word becomes a row: the word fills the title
property, and the meaning, source and date fill the first matching **Meaning** / **URL** / **Date**
properties (names are matched loosely — `Definition`, `Notes`, `Source`, `Added` all work). If the
database has nowhere to put the meaning, it goes in the row's page body instead.

### Entry formats

Choose in options; the preview updates live.

- **Bullet** — `• **word** — meaning`, with the source as a nested line. The default.
- **Toggle** — the word is the toggle, the meaning is hidden inside it. Good for self-testing.
- **Paragraph** — a plain text block.

The source link and the date can each be switched off.

## Privacy

- The integration token is kept in `chrome.storage.local`, deliberately **not** in Chrome Sync, so
  it never leaves this computer. Preferences (format, destination id) do sync.
- The only host the extension can talk to is `api.notion.com`.
- There is no content script. Page access happens only through `activeTab`, which Chrome grants for
  a single tab when you use the context menu or open the popup — so the extension can read your
  selection at that moment and nothing else.

## Troubleshooting

| Message | Fix |
| --- | --- |
| "The integration token was rejected" | Re-copy the secret from notion.so/my-integrations. |
| "Notion cannot see that page" | Page → **•••** → **Connections** → add your integration. |
| Nothing happens on `chrome://` pages, the Web Store, or PDFs | Chrome blocks extensions there. Use the popup and type the word in. |
| The context menu is missing | `chrome://extensions` → reload the extension. |

Errors are also visible in the service worker console: `chrome://extensions` → **service worker**.

## Development

```
npm test          # 40 tests: parsing, Notion payloads, and the worker end to end
npm run icons     # regenerate icons/*.png
npm run zip       # package for distribution
```

No build step and no dependencies — the extension loads the source directly.

| File | Role |
| --- | --- |
| `src/background.js` | Service worker: context menus, the save path, toasts |
| `src/notion.js` | Notion API client and block/property builders |
| `src/parse.js` | Splitting a selection into word + meaning, Notion id parsing |
| `src/storage.js` | Settings, history, and the stashed word |
| `popup.html` · `src/popup.js` | Quick-add popup |
| `options.html` · `src/options.js` | Setup and preferences |
| `tests/` | Node's test runner against stubbed `chrome.*` and `fetch` |
