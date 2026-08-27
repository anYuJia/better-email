export type ComposerOriginalQuoteParts = {
  meta: string[];
  content: string;
};

const originalMessageMarkerPattern = /\n{0,2}-{2,}\s*(?:原始邮件|original message|forwarded message)\s*-{2,}[\s\S]*$/i;
const originalMessageMetaPattern = /^\s*(?:发件人|收件人|抄送|时间|日期|主题|from|to|cc|date|subject)\s*[:：]/i;

export function splitEditableBody(body: string) {
  const match = body.match(originalMessageMarkerPattern);
  if (!match || match.index === undefined) {
    return { editableBody: body, originalQuote: '' };
  }
  return {
    editableBody: body.slice(0, match.index).trimEnd(),
    originalQuote: body.slice(match.index).trimStart(),
  };
}

export function joinEditableBody(editableBody: string, originalQuote: string) {
  if (!originalQuote) return editableBody;
  const trimmedEditable = editableBody.trimEnd();
  return `${trimmedEditable}${trimmedEditable ? '\n\n' : ''}${originalQuote}`;
}

export type AutoLinkMatch = {
  index: number;
  raw: string;
  text: string;
  href: string;
};

const autoLinkPattern = /(?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;
const trailingAutoLinkPunctuationPattern = /[.,!?;:，。！？；：、)\]}]+$/;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlWithBreaks(value: string) {
  return escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
}

export function normalizeAutoLink(value: string) {
  const text = value.trim().replace(trailingAutoLinkPunctuationPattern, '');
  if (!text) return null;
  const href = /^(?:https?:\/\/)/i.test(text) ? text : `https://${text}`;

  try {
    const parsed = new URL(href);
    const hasWebHostname = parsed.hostname === 'localhost'
      || parsed.hostname.includes('.')
      || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname);
    if (!['http:', 'https:'].includes(parsed.protocol) || !hasWebHostname) return null;
  } catch {
    return null;
  }

  return { text, href };
}

export function findAutoLinkMatches(value: string): AutoLinkMatch[] {
  const matches: AutoLinkMatch[] = [];
  const pattern = new RegExp(autoLinkPattern.source, autoLinkPattern.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const raw = match[0];
    const index = match.index;
    const isExplicitLink = /^(?:https?:\/\/|www\.)/i.test(raw);
    const precedingCharacter = value[index - 1] ?? '';
    if (!isExplicitLink && /[\w@]/.test(precedingCharacter)) continue;

    const normalized = normalizeAutoLink(raw);
    if (!normalized) continue;
    matches.push({ index, raw, ...normalized });
  }

  return matches;
}

export function plainTextToRichHtml(value: string) {
  const matches = findAutoLinkMatches(value);
  if (matches.length === 0) return escapeHtmlWithBreaks(value);

  let html = '';
  let cursor = 0;
  for (const match of matches) {
    html += escapeHtmlWithBreaks(value.slice(cursor, match.index));
    html += `<a class="composer-auto-link" href="${escapeHtml(match.href)}">${escapeHtml(match.text)}</a>`;
    html += escapeHtmlWithBreaks(match.raw.slice(match.text.length));
    cursor = match.index + match.raw.length;
  }
  return html + escapeHtmlWithBreaks(value.slice(cursor));
}

function stripQuotePrefix(line: string) {
  return line.replace(/^\s*(?:>\s*)+/, '').trimEnd();
}

export function parseOriginalQuote(originalQuote: string): ComposerOriginalQuoteParts {
  const lines = originalQuote.replace(/\r\n?/g, '\n').split('\n');
  const [, ...rest] = lines;
  const meta: string[] = [];
  const content: string[] = [];
  let sawContent = false;

  for (const line of rest) {
    if (!sawContent && originalMessageMetaPattern.test(line)) {
      meta.push(line.trim());
      continue;
    }
    if (!sawContent && !line.trim()) {
      continue;
    }
    sawContent = true;
    content.push(stripQuotePrefix(line));
  }

  return {
    meta,
    content: content.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}
