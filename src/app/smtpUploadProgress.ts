/** A value exists only when SMTP MIME bytes have actually been written. */
export function smtpUploadPercent(message: string | null | undefined): number | null {
  const match = message?.match(/SMTP 上传 (\d{1,3})% · \d+(?:\.\d+)? (?:B|KB|MB) \/ \d+(?:\.\d+)? (?:B|KB|MB)$/);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}
