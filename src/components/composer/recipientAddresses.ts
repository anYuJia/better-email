export const recipientEmailPattern = /^[^\s@,，;；<>]+@[^\s@,，;；<>]+\.[^\s@,，;；<>]+$/;

export type ParsedRecipientToken = {
  raw: string;
  email: string;
  displayName: string;
  normalized: string;
  valid: boolean;
};

export type RecipientParseResult = {
  tokens: ParsedRecipientToken[];
  valid: ParsedRecipientToken[];
  invalid: ParsedRecipientToken[];
  duplicates: ParsedRecipientToken[];
};

const namedMailboxPattern = /^(?:"(?:\\.|[^"\\\r\n])*"|[^"<>;,，；\r\n\t]*)\s*<([^<>]+)>$/;

// Preserve the open final part so typing and pasting share one tokenizer.
export function recipientInputParts(value: string) {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quoted && character === '\\') {
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && /[,，;；\r\n\t]/.test(character)) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  return [...parts, value.slice(start)];
}

export function splitRecipientTokens(value: string) {
  return recipientInputParts(value).map((part) => part.trim()).filter(Boolean);
}

export function parseRecipientToken(raw: string): ParsedRecipientToken {
  const trimmed = raw.trim();
  const namedMailbox = trimmed.match(namedMailboxPattern);
  const email = (namedMailbox?.[1] ?? trimmed).trim();
  const normalized = email.toLowerCase();
  return {
    raw: trimmed,
    email,
    displayName: namedMailbox ? trimmed.slice(0, trimmed.lastIndexOf('<')).trim() : '',
    normalized,
    valid: recipientEmailPattern.test(email),
  };
}

export function parseRecipientInput(value: string): RecipientParseResult {
  const tokens = splitRecipientTokens(value).map(parseRecipientToken);
  const seen = new Set<string>();
  const valid: ParsedRecipientToken[] = [];
  const invalid: ParsedRecipientToken[] = [];
  const duplicates: ParsedRecipientToken[] = [];

  for (const token of tokens) {
    if (!token.valid) {
      invalid.push(token);
      continue;
    }
    if (seen.has(token.normalized)) {
      duplicates.push(token);
      continue;
    }
    seen.add(token.normalized);
    valid.push(token);
  }

  return { tokens, valid, invalid, duplicates };
}

export function canonicalRecipientEmails(...values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    for (const token of parseRecipientInput(value).valid) {
      seen.add(token.normalized);
    }
  }
  return seen;
}

export function uniqueRecipientEmails(values: string[], blocked = new Set<string>()) {
  const seen = new Set(blocked);
  const result: string[] = [];
  for (const value of values) {
    const token = parseRecipientToken(value);
    if (!token.valid || seen.has(token.normalized)) continue;
    seen.add(token.normalized);
    result.push(token.email);
  }
  return result;
}

export function recipientErrorMessage(invalid: ParsedRecipientToken[], duplicateCount = 0) {
  const messages: string[] = [];
  if (invalid.length) {
    const raw = invalid[0].raw;
    const first = raw.length > 60 ? raw.slice(0, 59) + '…' : raw;
    const count = invalid.length > 1 ? `等 ${invalid.length} 个地址` : '';
    messages.push(`「${first}」${count}格式不正确，请修正或移除`);
  }
  if (duplicateCount > 0) messages.push(`${duplicateCount} 个重复地址已跳过`);
  return messages.join('；');
}

export function invalidDraftRecipientMessage(draft: { to: string; cc: string; bcc: string }) {
  const fields = [['收件人', draft.to], ['抄送', draft.cc], ['密送', draft.bcc]];
  for (const [label, value] of fields) {
    const [invalid] = parseRecipientInput(value).invalid;
    if (invalid) return `${label}地址「${invalid.raw}」格式不正确，请修正或移除。`;
  }
  return null;
}
