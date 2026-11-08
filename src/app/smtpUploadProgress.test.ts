import { describe, expect, it } from 'vitest';
import { smtpUploadPercent } from './smtpUploadProgress';

describe('SMTP upload display', () => {
  it('uses only actual SMTP byte progress, not overall or attachment stages', () => {
    expect(smtpUploadPercent('第 2/3 封 · SMTP 上传 42% · 4 MB / 10 MB')).toBe(42);
    expect(smtpUploadPercent('附件处理 42%')).toBeNull();
    expect(smtpUploadPercent('上传完成，等待服务器确认')).toBeNull();
    expect(smtpUploadPercent('第 1/1 封（SMTP 上传 99%）· SMTP 上传 42% · 4 MB / 10 MB')).toBe(42);
  });
});
