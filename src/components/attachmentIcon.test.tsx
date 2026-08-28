import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentIcon, attachmentIconAsset } from './attachmentIcon';

afterEach(() => {
  cleanup();
});

describe('attachmentIconAsset', () => {
  it('maps supplied file formats to transparent artwork', () => {
    expect(attachmentIconAsset('photo.JPEG', 'image/jpeg')).toBe('/attachment-icons/jpg.png');
    expect(attachmentIconAsset('release.tar.gz', 'application/octet-stream')).toBe('/attachment-icons/zip.png');
    expect(attachmentIconAsset('deck', 'application/vnd.ms-powerpoint')).toBe('/attachment-icons/pptx.png');
    expect(attachmentIconAsset('script', 'text/javascript')).toBe('/attachment-icons/js.png');
  });

  it('returns no artwork for unsupported formats so callers can keep their fallback', () => {
    expect(attachmentIconAsset('archive.unknown', 'application/octet-stream')).toBeNull();
  });
});

describe('AttachmentIcon', () => {
  it('renders the supplied asset when a matching format is available', () => {
    const { container } = render(<AttachmentIcon filename="roadmap.pdf" mimeType="application/pdf" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/attachment-icons/pdf.png');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('renders the caller fallback for unknown formats', () => {
    const { container } = render(
      <AttachmentIcon filename="roadmap.unknown" fallback={<span data-testid="fallback">文件</span>} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="fallback"]')?.textContent).toBe('文件');
  });
});
