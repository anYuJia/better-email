import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fieldsSource = readFileSync(
  join(repoRoot, 'src/components/composer/ComposerPrimaryFields.tsx'),
  'utf8',
);
const polishCss = readFileSync(
  join(repoRoot, 'src/components/composer/composer-polish.css'),
  'utf8',
);

describe('composer attachment strip', () => {
  it('keeps regular attachments visible and removable', () => {
    expect(fieldsSource).toContain('composer-body-attachments composer-attachment-list');
    expect(fieldsSource).toContain('aria-label={`移除 ${attachment.filename}`}');
    expect(fieldsSource).toContain('onClick={() => onRemoveAttachment(attachmentIndex)}');
  });

  it('pins attachments above the footer as a horizontal strip', () => {
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?position:\s*sticky;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?bottom:\s*0;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?overflow-x:\s*auto;/);
  });

  it('places the remove action in the attachment card top-right corner', () => {
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?position:\s*absolute;/);
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?top:\s*5px;/);
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?right:\s*5px;/);
  });
});
