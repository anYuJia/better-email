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
const composerCss = readFileSync(
  join(repoRoot, 'src/components/composer/composer.css'),
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
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?min-width:\s*0;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?max-width:\s*100%;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?overflow-x:\s*auto;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?touch-action:\s*pan-x;/);
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile\s*\{[\s\S]*?min-width:\s*190px;/);
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile\s*\{[\s\S]*?flex:\s*0 0 190px;/);
  });

  it('places the remove action in the attachment card top-right corner', () => {
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?position:\s*absolute;/);
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?top:\s*5px;/);
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?right:\s*5px;/);
  });

  it('fits supplied artwork inside the compact filemark instead of clipping it', () => {
    expect(composerCss).toMatch(/\.composer \.composer-attachment-filemark-has-asset img\s*\{[\s\S]*?max-width:\s*38px;[\s\S]*?max-height:\s*42px;/);
  });
});
