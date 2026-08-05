const CHINESE_CHAR_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const JAPANESE_PATTERN = /[\u3040-\u309F\u30A0-\u30FF]/;
const KOREAN_PATTERN = /[\uAC00-\uD7AF\u1100-\u11FF]/;
const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;
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
