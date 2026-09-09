import { describe, expect, it } from 'vitest';
import {
  assessTranslationNeed,
  countChineseChars,
  extractPlainText,
  languageLabel,
  prepareTranslationSource,
  sanitizeTranslatedHtml,
  stripMessageNoise,
} from './translation';

describe('translation language detection', () => {
  it('does not flag Chinese emails', () => {
    const assessment = assessTranslationNeed(
      '你好，附件中是本周的会议纪要。请查收。',
      '',
    );
    expect(assessment.foreign).toBe(false);
    expect(assessment.language).toBe('zh');
  });

  it('flags English emails', () => {
    const assessment = assessTranslationNeed(
      'Hi team, please find the meeting notes attached. Thanks!',
      '',
    );
    expect(assessment.foreign).toBe(true);
    expect(assessment.language).toBe('en');
  });

  it('flags Japanese emails', () => {
    const assessment = assessTranslationNeed(
      'こんにちは、会議の議事録を添付しました。ご確認ください。',
      '',
    );
    expect(assessment.foreign).toBe(true);
    expect(assessment.language).toBe('ja');
  });

  it('flags Korean emails', () => {
    const assessment = assessTranslationNeed(
      '안녕하세요, 회의록을 첨부했습니다. 확인 부탁드립니다.',
      '',
    );
    expect(assessment.foreign).toBe(true);
    expect(assessment.language).toBe('ko');
  });

  it('ignores urls, emails, html tags and signature noise', () => {
    const assessment = assessTranslationNeed(
      '<p>Hi https://example.com</p>\n\n--\nSent from iPhone',
      '<div>Hi <a href="https://example.com">link</a></div><p>--</p><p>Sent from iPhone</p>',
    );
    expect(assessment.foreign).toBe(true);
    expect(assessment.meaningfulLength).toBeGreaterThan(0);
    expect(assessment.meaningfulLength).toBeLessThan(10);
  });

  it('does not flag empty or signature-only content', () => {
    const assessment = assessTranslationNeed('--\nSent from iPhone', '');
    expect(assessment.foreign).toBe(false);
  });

  it('mixed chinese email stays un-flagged', () => {
    const assessment = assessTranslationNeed(
      '这是一封中文邮件，主要内容是本周的安排。There is only a little English here 其余全部都是中文内容中文内容',
      '',
    );
    expect(assessment.foreign).toBe(false);
    expect(assessment.language).toBe('zh');
  });

  it('mostly-english mixed email is flagged', () => {
    const assessment = assessTranslationNeed(
      'This email is mostly in English with lots of text about the project plan and next steps for everyone involved. 中文只有一点点',
      '',
    );
    expect(assessment.foreign).toBe(true);
    expect(assessment.language).toBe('en');
  });

  it('extracts plain text from html', () => {
    const text = extractPlainText('', '<div>Hello <b>world</b></div>');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('<div>');
  });

  it('counts chinese characters', () => {
    expect(countChineseChars('你好abc')).toBe(2);
    expect(countChineseChars('english')).toBe(0);
  });

  it('labels languages in chinese', () => {
    expect(languageLabel('ja')).toBe('日文');
    expect(languageLabel('ko')).toBe('韩文');
    expect(languageLabel('en')).toBe('英文');
  });

  it('strips signature noise', () => {
    const cleaned = stripMessageNoise('Hello\n\nBest regards,\nJohn\n--\nSent from Better Email');
    expect(cleaned).toContain('Hello');
    expect(cleaned).not.toContain('Sent from');
  });

  it('protects HTML structure, links, images and proper nouns during translation', () => {
    const source = prepareTranslationSource(
      '',
      '<p>Welcome to TRAE</p><a href="https://example.com/docs">OpenAI</a><img src="cid:logo@example.com">',
    );

    expect(source.format).toBe('html');
    expect(source.content).not.toContain('<p>');
    expect(source.content).not.toContain('https://example.com/docs');
    expect(source.content).not.toContain('TRAE');
    expect(source.content).not.toContain('OpenAI');

    const restored = source.restore(source.content.replace('Welcome to', '欢迎来到'));
    expect(restored).toContain('<p>欢迎来到 TRAE</p>');
    expect(restored).toContain('<a href="https://example.com/docs">OpenAI</a>');
    expect(restored).toContain('<img src="cid:logo@example.com">');
  });

  it('keeps plain-text URLs, addresses and variables exact', () => {
    const source = prepareTranslationSource(
      'Please visit https://example.com and email support@example.com. Use {{contact.name}}.',
      '',
    );
    const restored = source.restore(source.content.replace('Please visit', '请访问'));

    expect(restored).toContain('https://example.com');
    expect(restored).toContain('support@example.com');
    expect(restored).toContain('{{contact.name}}');
  });

  it('removes active elements from translated HTML before rendering', () => {
    const safe = sanitizeTranslatedHtml('<p onclick="alert(1)">你好</p><script>alert(1)</script>');
    expect(safe).toContain('<p>你好</p>');
    expect(safe).not.toContain('onclick');
    expect(safe).not.toContain('<script>');
  });
});
