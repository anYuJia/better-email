const CHINESE_CHAR_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const JAPANESE_PATTERN = /[\u3040-\u309F\u30A0-\u30FF]/;
const KOREAN_PATTERN = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/g;
const HTML_TAG_PATTERN = /<[^>]*>/g;
const QUOTE_PATTERN = /^[>›»\s]*$/gm;
const SIGNATURE_PATTERNS = [
  /^-{2,}\s*$/gm,
  /^sent from .*$/gim,
  /^(regards|best regards|kind regards|warm regards|thanks|cheers|sincerely|best),?\s*$/gim,
  /^此致|^敬礼|^祝好|^此致敬礼/gm,
];

export type DetectedLanguage =
  | 'zh'
  | 'ja'
  | 'ko'
  | 'en'
  | 'other'
  | 'empty';

export type TranslationAssessment = {
  language: DetectedLanguage;
  sampleLength: number;
  meaningfulLength: number;
  chineseRatio: number;
  foreign: boolean;
};

export type TranslationSourceFormat = 'html' | 'plain';

export type PreparedTranslationSource = {
  content: string;
  format: TranslationSourceFormat;
  restore: (translated: string) => string;
};

type ProtectedTranslationToken = {
  token: string;
  value: string;
};

const TRANSLATION_URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/g;
const TRANSLATION_EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TRANSLATION_VARIABLE_PATTERN = /\{\{[^{}\n]+\}\}/g;
const TRANSLATION_CODE_PATTERN = /`[^`\n]+`/g;
const TRANSLATION_PROPER_NOUN_PATTERN = /\b(?:[A-Z]{2,}[A-Z0-9-]*|[A-Za-z]+[A-Z][A-Za-z0-9-]*|[A-Z][A-Za-z]+\d+)\b/g;

export function stripMessageNoise(input: string): string {
  let text = input
    .replace(HTML_TAG_PATTERN, '\n')
    .replace(EMAIL_PATTERN, ' ')
    .replace(URL_PATTERN, ' ')
    .replace(QUOTE_PATTERN, ' ')
    .replace(/\r\n/g, '\n');
  for (const pattern of SIGNATURE_PATTERNS) {
    text = text.replace(pattern, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function countChineseChars(text: string): number {
  let count = 0;
  for (const character of text) {
    if (CHINESE_CHAR_PATTERN.test(character)) count += 1;
  }
  return count;
}

export function countJapaneseChars(text: string): number {
  let count = 0;
  for (const character of text) {
    if (JAPANESE_PATTERN.test(character)) count += 1;
  }
  return count;
}

export function countKoreanChars(text: string): number {
  let count = 0;
  for (const character of text) {
    if (KOREAN_PATTERN.test(character)) count += 1;
  }
  return count;
}

export function countMeaningfulChars(text: string): number {
  let count = 0;
  for (const character of text) {
    if (/\p{L}/u.test(character)) count += 1;
  }
  return count;
}

export function extractPlainText(body: string, sanitizedHtml: string): string {
  const html = sanitizedHtml.trim();
  if (html) {
    return stripMessageNoise(html);
  }
  return stripMessageNoise(body);
}

function nextTranslationToken(kind: string, replacements: ProtectedTranslationToken[]): string {
  return `__BETTER_EMAIL_${kind}_${replacements.length}__`;
}

function protectMatches(
  value: string,
  pattern: RegExp,
  kind: string,
  replacements: ProtectedTranslationToken[],
): string {
  return value.replace(pattern, (match) => {
    const token = nextTranslationToken(kind, replacements);
    replacements.push({ token, value: match });
    return token;
  });
}

function protectTranslatableText(
  value: string,
  replacements: ProtectedTranslationToken[],
): string {
  let protectedText = value;
  // Keep machine-readable values and inline code exact. URL/e-mail protection
  // is also applied to plain-text messages, where there is no HTML attribute
  // available to carry the original target.
  protectedText = protectMatches(
    protectedText,
    TRANSLATION_VARIABLE_PATTERN,
    'VARIABLE',
    replacements,
  );
  protectedText = protectMatches(protectedText, TRANSLATION_CODE_PATTERN, 'CODE', replacements);
  protectedText = protectMatches(protectedText, TRANSLATION_EMAIL_PATTERN, 'EMAIL', replacements);
  protectedText = protectMatches(protectedText, TRANSLATION_URL_PATTERN, 'URL', replacements);
  return protectMatches(protectedText, TRANSLATION_PROPER_NOUN_PATTERN, 'PROPER_NOUN', replacements);
}

/**
 * Split an HTML string into tags and text without changing the original tags.
 * A small scanner is used instead of a regex so quoted `>` characters in an
 * attribute do not prematurely end a protected tag.
 */
function splitHtmlSource(source: string): Array<{ isTag: boolean; value: string }> {
  const chunks: Array<{ isTag: boolean; value: string }> = [];
  let textStart = 0;
  let index = 0;

  const pushText = (end: number) => {
    if (end > textStart) chunks.push({ isTag: false, value: source.slice(textStart, end) });
  };

  while (index < source.length) {
    if (source[index] !== '<') {
      index += 1;
      continue;
    }

    pushText(index);
    let end = index + 1;
    let quote = '';
    if (source.startsWith('<!--', index)) {
      const commentEnd = source.indexOf('-->', index + 4);
      end = commentEnd >= 0 ? commentEnd + 3 : source.length;
    } else {
      for (; end < source.length; end += 1) {
        const character = source[end];
        if (quote) {
          if (character === quote) quote = '';
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === '>') {
          end += 1;
          break;
        }
      }
    }

    chunks.push({ isTag: true, value: source.slice(index, end) });
    index = end;
    textStart = end;
  }

  pushText(source.length);
  return chunks;
}

function stripTranslationCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:html|text|markdown)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function restoreProtectedTranslationTokens(
  translated: string,
  replacements: ProtectedTranslationToken[],
): string {
  let restored = stripTranslationCodeFence(translated);
  for (const replacement of replacements) {
    restored = restored.split(replacement.token).join(replacement.value);
  }
  return restored.trim();
}

/**
 * Prepare an email for translation while keeping the structure that must not
 * be translated. HTML tags are represented by opaque tokens, so the model can
 * translate only text nodes; the exact original tags then get restored before
 * rendering. This keeps links, images, mailto targets, URLs and variables
 * usable after translation.
 */
export function prepareTranslationSource(
  body: string,
  sanitizedHtml: string,
): PreparedTranslationSource {
  const html = sanitizedHtml.trim();
  if (html) {
    const replacements: ProtectedTranslationToken[] = [];
    const content = splitHtmlSource(html)
      .map((chunk) => {
        if (chunk.isTag) {
          const token = nextTranslationToken('TAG', replacements);
          replacements.push({ token, value: chunk.value });
          return token;
        }
        return protectTranslatableText(chunk.value, replacements);
      })
      .join('');

    return {
      content,
      format: 'html',
      restore: (translated) => restoreProtectedTranslationTokens(translated, replacements),
    };
  }

  const replacements: ProtectedTranslationToken[] = [];
  const content = protectTranslatableText(body.replace(/\r\n?/g, '\n').trim(), replacements);
  return {
    content,
    format: 'plain',
    restore: (translated) => restoreProtectedTranslationTokens(translated, replacements),
  };
}

function isRemoteResourceUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('//');
}

/**
 * AI output is untrusted even when the input HTML was sanitized. Remove the
 * elements that could execute or load active document content before it is
 * handed to the isolated email renderer. Remote visual resources introduced
 * by the model are stripped as well; original remote-image behavior remains
 * governed by the mail reader's normal trust policy rather than AI output.
 */
export function sanitizeTranslatedHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.querySelectorAll('script, iframe, object, embed, form, base, meta, link').forEach((element) => {
    element.remove();
  });
  document.querySelectorAll<HTMLElement>('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (/^on/i.test(name)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'style' && /(?:url|image-set)\s*\(/i.test(value)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (['src', 'poster', 'background'].includes(name) && isRemoteResourceUrl(value)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'srcset') {
        const candidates = value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '');
        if (candidates.some(isRemoteResourceUrl)) {
          element.removeAttribute(attribute.name);
        }
      }
    });
  });
  return document.body.innerHTML;
}

export function assessTranslationNeed(body: string, sanitizedHtml: string): TranslationAssessment {
  const sample = extractPlainText(body, sanitizedHtml);
  const meaningfulLength = countMeaningfulChars(sample);
  if (meaningfulLength === 0) {
    return { language: 'empty', sampleLength: sample.length, meaningfulLength: 0, chineseRatio: 0, foreign: false };
  }
  const chineseCount = countChineseChars(sample);
  const japaneseCount = countJapaneseChars(sample);
  const koreanCount = countKoreanChars(sample);
  const chineseRatio = chineseCount / meaningfulLength;
  let language: DetectedLanguage = 'en';
  if (japaneseCount >= meaningfulLength * 0.15) {
    language = 'ja';
  } else if (koreanCount >= meaningfulLength * 0.15) {
    language = 'ko';
  } else if (chineseRatio >= 0.3) {
    language = 'zh';
  }
  const foreign = language !== 'zh';
  return { language, sampleLength: sample.length, meaningfulLength, chineseRatio, foreign };
}

export function languageLabel(language: DetectedLanguage): string {
  switch (language) {
    case 'ja':
      return '日文';
    case 'ko':
      return '韩文';
    case 'en':
      return '英文';
    case 'other':
      return '外语';
    default:
      return language;
  }
}
