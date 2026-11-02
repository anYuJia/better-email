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
    expect(fieldsSource).toContain('onRemoveAttachment(attachmentIndex)');
  });

  it('pins attachments above the footer as a horizontal strip', () => {
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?position:\s*sticky;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?bottom:\s*0;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?min-width:\s*0;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?max-width:\s*100%;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?overflow-x:\s*auto;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?overflow-y:\s*auto;/);
    expect(polishCss).toMatch(/\.composer \.composer-body-attachments\s*\{[\s\S]*?touch-action:\s*auto;/);
  });

  it('keeps removal in its own layout column with a touch-sized target', () => {
    expect(polishCss).toMatch(/\.composer \.composer-attachment-tile > button\s*\{[\s\S]*?position:\s*static;/);
    const touch = polishCss.slice(polishCss.indexOf('@media (max-width: 767px), (pointer: coarse)'));
    expect(touch).toMatch(/grid-template-columns:[^;]*44px;/);
    expect(touch).toMatch(/\.composer \.composer-attachment-tile > button\s*\{\s*width:\s*44px;\s*min-height:\s*44px;/);
  });

  it('uses the same line icon family as compose controls without decorative file artwork', () => {
    expect(fieldsSource).not.toContain('attachmentIconAsset');
    expect(fieldsSource).toContain('<FileText size={20}');
    expect(composerCss).not.toContain('composer-attachment-filemark-fold');
    expect(polishCss).toMatch(/\.composer \.composer-attachment-filemark svg\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;/);
  });
});
