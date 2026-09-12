/**
 * Pure text/ID helpers. No `chrome.*` access here so this module can be unit
 * tested with plain Node (`npm test`).
 */

/** A "word-like" string is short enough to plausibly be a headword. */
export function isWordLike(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return false;
  return trimmed.split(/\s+/).length <= 5;
}

const INLINE_SEPARATORS = [
  /\s+[—–]\s+/, // em / en dash surrounded by spaces
  /\s+-\s+/, //    hyphen used as a dash
  /\s*:\s+/, //    "word: meaning"
  /\s+=\s+/, //    "word = meaning"
];

/** Strip trailing separators/punctuation left over after a split. */
function tidyWord(text) {
  return text
    .trim()
    .replace(/^[\s"'“”‘’(\[]+/, '')
    .replace(/[\s:=\-–—."'“”‘’)\]]+$/, '')
    .trim();
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Split a single selection into a headword and its meaning.
 *
 * Handles the shapes you actually get when dragging across a dictionary result:
 *   "ubiquitous\npresent everywhere"   (line break)
 *   "ubiquitous — present everywhere"  (dash)
 *   "ubiquitous: present everywhere"   (colon)
 * Falls back to word-only or meaning-only when there is nothing to split on.
 *
 * @returns {{word: string, meaning: string}}
 */
export function splitWordAndMeaning(raw) {
  const text = (raw || '').replace(/[\u00a0\u200b]/g, ' ').trim();
  if (!text) return { word: '', meaning: '' };

  // 1. A short first line followed by more text is the clearest signal — unless
  //    that line already carries a separator, in which case it is a wrapped
  //    "word — meaning" and rule 2 should decide where to cut.
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && !INLINE_SEPARATORS.some((separator) => separator.test(lines[0]))) {
    const head = tidyWord(lines[0]);
    if (isWordLike(head)) {
      return { word: head, meaning: collapse(lines.slice(1).join(' ')) };
    }
  }

  // 2. Otherwise look for an inline separator with a word-like left side.
  const oneLine = collapse(text);
  for (const separator of INLINE_SEPARATORS) {
    const match = oneLine.match(separator);
    if (!match || match.index === undefined) continue;
    const left = tidyWord(oneLine.slice(0, match.index));
    const right = oneLine.slice(match.index + match[0].length).trim();
    if (left && right && isWordLike(left)) {
      return { word: left, meaning: collapse(right) };
    }
  }

  // 3. Nothing to split: short selections are the word, long ones the meaning.
  return isWordLike(oneLine)
    ? { word: tidyWord(oneLine), meaning: '' }
    : { word: '', meaning: oneLine };
}

const HEX32 = /[0-9a-f]{32}(?![0-9a-f])/gi;

/**
 * Accepts a Notion URL, a dashed UUID, or a bare 32-char id and returns a
 * dashed UUID. Returns null when the input holds no usable id.
 *
 * For database URLs (`/Name-<db id>?v=<view id>`) the path id wins over the
 * `?v=` view id, which is not addressable through the API.
 */
export function normalizeNotionId(input) {
  const value = (input || '').trim();
  if (!value) return null;

  let candidate = value;
  if (/^https?:\/\//i.test(value)) {
    let path;
    try {
      path = new URL(value).pathname;
    } catch {
      return null;
    }
    candidate = decodeURIComponent(path);
  }

  const matches = candidate.replace(/-/g, '').match(HEX32);
  if (!matches || !matches.length) return null;
  const id = matches[matches.length - 1].toLowerCase();
  return [
    id.slice(0, 8),
    id.slice(8, 12),
    id.slice(12, 16),
    id.slice(16, 20),
    id.slice(20),
  ].join('-');
}

/** Shorten a string for menu labels and toasts. */
export function truncate(text, max = 40) {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
