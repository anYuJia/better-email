import { describe, expect, it } from 'vitest';
import {
  assessTranslationNeed,
  countChineseChars,
  extractPlainText,
  languageLabel,
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
});
