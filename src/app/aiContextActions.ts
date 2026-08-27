import type { Message } from './types';
import { extractPlainText } from './translation';

export type AiContextActionId = 'summarize' | 'reply' | 'translate' | 'polish';

export const aiContextActions: ReadonlyArray<{
  id: AiContextActionId;
  label: string;
  surface: 'reader' | 'composer' | 'both';
}> = [
  { id: 'summarize', label: '总结邮件', surface: 'reader' },
  { id: 'reply', label: '生成回复', surface: 'reader' },
  { id: 'translate', label: '翻译', surface: 'both' },
  { id: 'polish', label: '润色正文', surface: 'composer' },
];

export function readerAiSource(message: Message): string {
  const body = extractPlainText(message.body, message.sanitized_html).trim();
  if (body) return body;
  return message.snippet.trim();
}

export function buildAiReplyPrompt(message: Message): string {
  const sender = message.sender_name.trim() || message.sender_email.trim() || '对方';
  const subject = message.subject.trim() || '(无主题)';
  const source = readerAiSource(message);
  return [
    '请根据下面的来信生成一封简洁、自然、专业的回复邮件。',
    '不要虚构事实；信息不足时使用克制、可继续沟通的表达。',
    '只需要生成可直接发送的回复正文。',
    `来信人：${sender}`,
    `主题：${subject}`,
    '来信正文：',
    source,
  ].join('\n');
}

export function normalizeGeneratedReply(content: string, message: Message): string {
  let body = content.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '');
  const bodyMatch = body.match(/(?:^|\n)正文[：:]\s*\n?([\s\S]*)$/i);
  if (bodyMatch) body = bodyMatch[1].trim();
  body = body.replace(/^主题[：:].*(?:\r?\n)+/i, '').trim();
  const contactName = message.sender_name.trim() || message.sender_email.trim();
  body = body.replace(/\{\{contact\.name\}\}/g, contactName);
  body = body.replace(/\{\{account\.email\}\}/g, '').replace(/\n{3,}/g, '\n\n');
  return body.trim();
}

export function buildComposerPolishPrompt(body: string, instruction = '简洁、专业、自然') {
  return [
    `请把下面的邮件正文润色得${instruction}。`,
    '保留事实、称呼、链接、日期、数字和原有语言；不要新增未提供的信息。',
    '只输出润色后的正文。',
    body.trim(),
  ].join('\n');
}
