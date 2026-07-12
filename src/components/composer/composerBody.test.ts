import { describe, expect, it } from 'vitest';
import {
  joinEditableBody,
  parseOriginalQuote,
  splitEditableBody,
} from './composerBody';

describe('composer body helpers', () => {
  it('splits editable reply text from a read-only original quote', () => {
    const body = '新的回复\n\n---- 原始邮件 ----\n发件人：Ada\n主题：Roadmap\n\n> 第一行\n> 第二行';

    expect(splitEditableBody(body)).toEqual({
      editableBody: '新的回复',
      originalQuote: '---- 原始邮件 ----\n发件人：Ada\n主题：Roadmap\n\n> 第一行\n> 第二行',
    });
  });

  it('joins editable text back without duplicating blank lines', () => {
    expect(joinEditableBody('新的回复\n', '---- 原始邮件 ----\n正文')).toBe(
      '新的回复\n\n---- 原始邮件 ----\n正文',
    );
    expect(joinEditableBody('', '---- 原始邮件 ----\n正文')).toBe('---- 原始邮件 ----\n正文');
  });

  it('parses quote metadata and removes nested quote markers from content', () => {
    expect(parseOriginalQuote('---- Original Message ----\nFrom: Ada\nSubject: Hi\n\n> Hello\n> Team')).toEqual({
      meta: ['From: Ada', 'Subject: Hi'],
      content: 'Hello\nTeam',
    });
  });
});
