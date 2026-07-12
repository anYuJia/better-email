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
