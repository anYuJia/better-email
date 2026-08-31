import type { ComposeTemplate } from './types/composer';
import { readAppStorage, removeAppStorage } from './storageConfig';

export const composeTemplatesStorageKey = 'better-email.composeTemplates';

export const TEMPLATE_VARIABLES: Array<{
  name: string;
  label: string;
  description: string;
}> = [
  { name: '{{contact.name}}', label: '联系人姓名', description: '收件人联系人姓名（无联系人或无法解析时保留占位）' },
  { name: '{{contact.email}}', label: '联系人邮箱', description: '收件人邮箱地址' },
  { name: '{{account.email}}', label: '当前账号邮箱', description: '发件账号邮箱地址' },
  { name: '{{today}}', label: '今天日期', description: '格式为 YYYY-MM-DD' },
  { name: '{{signature}}', label: '签名', description: '当前发件身份的签名' },
];

export function normalizeTemplate(input: Partial<ComposeTemplate> & { id?: string; name: string }): ComposeTemplate {
  const now = new Date().toISOString();
  return {
    id: input.id ?? crypto?.randomUUID?.() ?? `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || '未命名模板',
    subject: input.subject ?? '',
    body: input.body ?? '',
    html_body: input.html_body ?? '',
    category: input.category ?? '',
    tags: input.tags ?? [],
    account_id: input.account_id ?? 0,
    is_favorite: input.is_favorite ?? false,
    created_at: input.created_at ?? now,
    updated_at: now,
  };
}

export function migrateLegacyTemplate(raw: unknown): ComposeTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.name !== 'string' || !entry.name.trim()) return null;
  const normalized = normalizeTemplate({
    id: typeof entry.id === 'string' ? entry.id : undefined,
    name: entry.name,
    subject: typeof entry.subject === 'string' ? entry.subject : '',
    body: typeof entry.body === 'string' ? entry.body : '',
    html_body: typeof entry.html_body === 'string' ? entry.html_body : '',
  });
  if (typeof entry.category === 'string') normalized.category = entry.category;
  if (Array.isArray(entry.tags)) {
    normalized.tags = entry.tags.filter((tag): tag is string => typeof tag === 'string');
  }
  if (typeof entry.account_id === 'number') normalized.account_id = entry.account_id;
  if (typeof entry.is_favorite === 'boolean') normalized.is_favorite = entry.is_favorite;
  return normalized;
}

export function loadTemplates(): ComposeTemplate[] {
  try {
    const raw = readAppStorage(composeTemplatesStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(migrateLegacyTemplate)
      .filter((template): template is ComposeTemplate => template !== null);
  } catch {
    return [];
  }
}

/**
 * 返回当前邮箱可使用的模板：0 表示明确共享给所有账号的模板；正数表示
 * 只属于对应邮箱账号的模板。统一范围下保留完整列表，方便在设置中查看归属。
 */
export function templatesForAccount(
  templates: ComposeTemplate[],
  accountId: number | null | undefined,
): ComposeTemplate[] {
  if (!accountId || accountId <= 0) return templates;
  return templates.filter((template) => template.account_id === 0 || template.account_id === accountId);
}

export function persistTemplates(templates: ComposeTemplate[]): void {
  window.localStorage.setItem(composeTemplatesStorageKey, JSON.stringify(templates));
}

export function saveTemplate(template: ComposeTemplate): ComposeTemplate[] {
  const templates = loadTemplates();
  const existingIndex = templates.findIndex((item) => item.id === template.id);
  const normalized = normalizeTemplate(template);
  if (existingIndex >= 0) {
    const next = [...templates];
    next[existingIndex] = normalized;
    persistTemplates(next);
    return next;
  }
  const next = [normalized, ...templates];
  persistTemplates(next);
  return next;
}

export function deleteTemplate(templateId: string): ComposeTemplate[] {
  const next = loadTemplates().filter((item) => item.id !== templateId);
  persistTemplates(next);
  return next;
}

export function duplicateTemplate(templateId: string): ComposeTemplate | null {
  const source = loadTemplates().find((item) => item.id === templateId);
  if (!source) return null;
  const copy = normalizeTemplate({
    ...source,
    id: undefined,
    name: `${source.name}（副本）`,
  });
  persistTemplates([copy, ...loadTemplates()]);
  return copy;
}

export function clearTemplates(): void {
  removeAppStorage(composeTemplatesStorageKey);
}

function resolveVariable(
  name: string,
  context: {
    contactName?: string;
    contactEmail?: string;
    accountEmail?: string;
    signature?: string;
  },
): string | null {
  switch (name) {
    case 'contact.name':
      return context.contactName?.trim() ? context.contactName.trim() : null;
    case 'contact.email':
      return context.contactEmail?.trim() ? context.contactEmail.trim() : null;
    case 'account.email':
      return context.accountEmail?.trim() ? context.accountEmail.trim() : null;
    case 'today': {
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    case 'signature':
      return context.signature?.trim() ? context.signature.trim() : null;
    default:
      return null;
  }
}

export function substituteTemplateVariables(
  text: string,
  context: {
    contactName?: string;
    contactEmail?: string;
    accountEmail?: string;
    signature?: string;
  },
): { resolved: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, name: string) => {
    const value = resolveVariable(name, context);
    if (value === null) {
      const placeholder = `{{${name}}}`;
      if (!unresolved.includes(placeholder)) unresolved.push(placeholder);
      return match;
    }
    return value;
  });
  return { resolved, unresolved };
}

export function parseAiGeneratedTemplate(content: string): { subject: string; body: string } {
  const lines = content.split('\n');
  let subject = '';
  const bodyLines: string[] = [];
  let inBody = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('主题：')) {
      subject = trimmed.slice('主题：'.length).trim();
      continue;
    }
    if (trimmed.startsWith('主题:')) {
      subject = trimmed.slice('主题:'.length).trim();
      continue;
    }
    if (trimmed === '正文：' || trimmed === '正文:') {
      inBody = true;
      continue;
    }
    if (inBody) {
      bodyLines.push(line);
    }
  }
  const body = bodyLines.join('\n').trim();
  return { subject: subject.trim(), body: body || content.trim() };
}
