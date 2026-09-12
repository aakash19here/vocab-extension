/**
 * Minimal Notion API client for this extension.
 *
 * Every call runs from the service worker (or an extension page), which is why
 * `https://api.notion.com/*` sits in `host_permissions` — extension pages with
 * host access are exempt from the CORS restrictions that would block these
 * requests from an ordinary web page.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** Notion rejects any single rich-text chunk longer than this. */
const RICH_TEXT_LIMIT = 2000;

export class NotionError extends Error {
  constructor(message, { status = 0, code = '', hint = '' } = {}) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

const HINTS = {
  unauthorized:
    'The integration token was rejected. Paste a fresh "Internal Integration Secret" from notion.so/my-integrations.',
  restricted_resource:
    'The integration exists but has no access to that page. Open the page in Notion → ••• → Connections → add your integration.',
  object_not_found:
    'Notion cannot see that page or database. Open it in Notion → ••• → Connections → add your integration, and double-check the link.',
  validation_error:
    'Notion rejected the request body. If you are saving into a database, make sure it still has its Word / Meaning properties.',
  rate_limited: 'Notion is rate limiting the integration. Wait a few seconds and try again.',
};

async function notionFetch(token, path, { method = 'GET', body } = {}) {
  if (!token) {
    throw new NotionError('No Notion token saved yet.', {
      code: 'no_token',
      hint: 'Open the extension options and paste your integration token.',
    });
  }

  let response;
  try {
    response = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new NotionError('Could not reach Notion. Check your connection.', {
      code: 'network_error',
      hint: String(cause && cause.message ? cause.message : cause),
    });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code = (payload && payload.code) || `http_${response.status}`;
    const message = (payload && payload.message) || `Notion returned HTTP ${response.status}.`;
    throw new NotionError(message, { status: response.status, code, hint: HINTS[code] || '' });
  }

  return payload;
}

/* ------------------------------------------------------------------ */
/* Rich text                                                           */
/* ------------------------------------------------------------------ */

/** Build rich-text objects, splitting anything over Notion's 2000-char cap. */
function richText(content, { bold = false, italic = false, color, link } = {}) {
  const value = String(content ?? '');
  if (!value) return [];
  const annotations = { bold, italic, ...(color ? { color } : {}) };
  const chunks = [];
  for (let i = 0; i < value.length; i += RICH_TEXT_LIMIT) {
    chunks.push({
      type: 'text',
      text: { content: value.slice(i, i + RICH_TEXT_LIMIT), link: link ? { url: link } : null },
      annotations,
    });
  }
  return chunks;
}

function formatDate(iso) {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Notion only accepts absolute http(s) links, and pages served from `file:` or
 * an extension give us something else — fall back to plain text there.
 */
function linkableUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** The small grey "source · date" line hung under each entry. */
function sourceLine(entry, { includeSource, includeDate }) {
  const parts = [];
  if (includeSource && entry.sourceUrl) {
    const url = linkableUrl(entry.sourceUrl);
    const label = entry.sourceTitle || (url ? url.hostname.replace(/^www\./, '') : entry.sourceUrl);
    parts.push(
      ...richText(label, {
        italic: true,
        color: 'gray',
        ...(url ? { link: url.href } : {}),
      }),
    );
  }
  if (includeDate) {
    if (parts.length) parts.push(...richText(' · ', { italic: true, color: 'gray' }));
    parts.push(...richText(formatDate(entry.savedAt), { italic: true, color: 'gray' }));
  }
  if (!parts.length) return null;
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: parts } };
}

/**
 * Turn one vocab entry into Notion blocks.
 * @param {{word: string, meaning: string, sourceUrl?: string, sourceTitle?: string, savedAt?: string}} entry
 * @param {{format?: 'bulleted'|'toggle'|'paragraph', includeSource?: boolean, includeDate?: boolean}} options
 */
export function buildBlocks(entry, options = {}) {
  const { format = 'bulleted', includeSource = true, includeDate = true } = options;
  const word = (entry.word || '').trim();
  const meaning = (entry.meaning || '').trim();
  const footer = sourceLine(entry, { includeSource, includeDate });

  if (format === 'toggle') {
    const children = [];
    if (meaning) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: richText(meaning) },
      });
    }
    if (footer) children.push(footer);
    return [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: richText(word || meaning, { bold: true }),
          children,
        },
      },
    ];
  }

  const inline = [];
  if (word) inline.push(...richText(word, { bold: true }));
  if (word && meaning) inline.push(...richText(' — '));
  if (meaning) inline.push(...richText(meaning));

  if (format === 'paragraph') {
    const blocks = [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: inline } },
    ];
    if (footer) blocks.push(footer);
    return blocks;
  }

  // Default: one bulleted item, with the source tucked underneath as a child.
  return [
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: inline,
        ...(footer ? { children: [footer] } : {}),
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Targets                                                             */
/* ------------------------------------------------------------------ */

function plainTitle(richTextArray) {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray.map((piece) => piece.plain_text || '').join('').trim();
}

function pageTitle(page) {
  const properties = page.properties || {};
  for (const property of Object.values(properties)) {
    if (property && property.type === 'title') return plainTitle(property.title);
  }
  return '';
}

/**
 * Look up a Notion id and report whether it is a page or a database.
 * Tries the database endpoint first: database ids also resolve as pages, but
 * only the database endpoint tells us about its properties.
 */
export async function resolveTarget(token, id) {
  try {
    const database = await notionFetch(token, `/databases/${id}`);
    return {
      type: 'database',
      id: database.id,
      title: plainTitle(database.title) || 'Untitled database',
      url: database.url,
      properties: database.properties || {},
    };
  } catch (error) {
    if (error.code !== 'object_not_found' && error.code !== 'validation_error') throw error;
  }

  const page = await notionFetch(token, `/pages/${id}`);
  return {
    type: 'page',
    id: page.id,
    title: pageTitle(page) || 'Untitled page',
    url: page.url,
  };
}

/** Confirm the token works and return the bot/workspace it belongs to. */
export async function whoAmI(token) {
  const me = await notionFetch(token, '/users/me');
  return {
    name: me.name || 'Integration',
    workspace: (me.bot && me.bot.workspace_name) || '',
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export async function appendToPage(token, pageId, blocks) {
  return notionFetch(token, `/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: { children: blocks },
  });
}

const MEANING_HINTS = /(mean|defin|descri|note|explan)/i;
const SOURCE_HINTS = /(source|url|link|ref)/i;
const DATE_HINTS = /(date|added|saved|created)/i;

/**
 * Map an entry onto a database's properties: the title property takes the
 * word, and the best-matching rich text / url / date properties take the rest.
 * Anything missing is simply skipped, so odd schemas still work.
 */
export function buildDatabaseProperties(entry, schema = {}) {
  const entries = Object.entries(schema);
  const byType = (type, hints) => {
    const candidates = entries.filter(([, property]) => property.type === type);
    const named = candidates.find(([name]) => hints.test(name));
    return (named || candidates[0] || [])[0];
  };

  const properties = {};
  const titleName = (entries.find(([, property]) => property.type === 'title') || [])[0];
  const word = (entry.word || '').trim();
  const meaning = (entry.meaning || '').trim();

  if (titleName) {
    properties[titleName] = { title: richText(word || meaning || 'Untitled') };
  }

  const meaningName = byType('rich_text', MEANING_HINTS);
  if (meaningName && meaning) {
    properties[meaningName] = { rich_text: richText(meaning) };
  }

  const sourceName = byType('url', SOURCE_HINTS);
  const sourceUrl = entry.sourceUrl ? linkableUrl(entry.sourceUrl) : null;
  if (sourceName && sourceUrl) {
    properties[sourceName] = { url: sourceUrl.href };
  }

  const dateName = byType('date', DATE_HINTS);
  if (dateName) {
    properties[dateName] = { date: { start: (entry.savedAt || new Date().toISOString()).slice(0, 10) } };
  }

  return properties;
}

export async function createDatabaseEntry(token, databaseId, entry, schema, options) {
  const properties = buildDatabaseProperties(entry, schema);
  const hasMeaningProperty = Object.values(properties).some((value) => 'rich_text' in value);
  // If the database has nowhere to put the meaning, keep it in the page body.
  const children =
    !hasMeaningProperty && (entry.meaning || '').trim()
      ? buildBlocks({ ...entry, word: '' }, options)
      : [];

  return notionFetch(token, '/pages', {
    method: 'POST',
    body: {
      parent: { database_id: databaseId },
      properties,
      ...(children.length ? { children } : {}),
    },
  });
}

/**
 * Save one entry to whichever target is configured.
 * @returns {Promise<{url: string}>} the created/updated Notion object
 */
export async function saveEntry(settings, entry) {
  const { token, targetId, targetType, format, includeSource, includeDate } = settings;
  if (!targetId) {
    throw new NotionError('No Notion page selected yet.', {
      code: 'no_target',
      hint: 'Open the extension options and paste the link to your vocabulary page.',
    });
  }

  const options = { format, includeSource, includeDate };
  const stamped = { ...entry, savedAt: entry.savedAt || new Date().toISOString() };

  let type = targetType;
  let schema = settings.targetProperties;
  if (type !== 'page' && type !== 'database') {
    const resolved = await resolveTarget(token, targetId);
    type = resolved.type;
    schema = resolved.properties;
  }

  if (type === 'database') {
    if (!schema || !Object.keys(schema).length) {
      schema = (await resolveTarget(token, targetId)).properties;
    }
    const page = await createDatabaseEntry(token, targetId, stamped, schema, options);
    return { url: page && page.url };
  }

  await appendToPage(token, targetId, buildBlocks(stamped, options));
  return { url: settings.targetUrl || '' };
}
