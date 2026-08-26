export const recipientEmailPattern = /^[^\s@,，;；<>]+@[^\s@,，;；<>]+\.[^\s@,，;；<>]+$/;

export type ParsedRecipientToken = {
  raw: string;
  email: string;
  normalized: string;
  valid: boolean;
};

export type RecipientParseResult = {
  tokens: ParsedRecipientToken[];
  valid: ParsedRecipientToken[];
  invalid: ParsedRecipientToken[];
  duplicates: ParsedRecipientToken[];
};

function extractEmail(token: string) {
  const trimmed = token.trim();
  const angleAddress = trimmed.match(/<([^<>]+)>/);
  return (angleAddress?.[1] ?? trimmed).trim();
}

export function splitRecipientTokens(value: string) {
  return value
    .split(/[,，;；\n\t]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function parseRecipientToken(raw: string): ParsedRecipientToken {
  const email = extractEmail(raw);
  const normalized = email.toLowerCase();
  return {
    raw: raw.trim(),
    email,
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

export function recipientErrorMessage(invalidCount: number, duplicateCount = 0) {
  const messages: string[] = [];
  if (invalidCount > 0) messages.push(`${invalidCount} 个地址格式不正确，已跳过`);
  if (duplicateCount > 0) messages.push(`${duplicateCount} 个重复地址已跳过`);
  return messages.join('；');
}
