import { describe, expect, it } from 'vitest';
import {
  buildForwardAttachmentPlan,
  forwardAttachmentStatus,
} from './forwarding';
import type { Attachment } from './types';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    message_id: 10,
    filename: 'report.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    is_downloaded: true,
    local_path: '/tmp/report.pdf',
    ...overrides,
  };
}

describe('forward attachment planning', () => {
  it('carries only fully downloaded attachments into a forward draft', () => {
    const plan = buildForwardAttachmentPlan([
      attachment(),
      attachment({
        id: 2,
        filename: 'remote.zip',
        is_downloaded: false,
        local_path: '',
      }),
      attachment({
        id: 3,
        filename: 'missing.txt',
        local_path: '',
      }),
    ]);

    expect(plan).toEqual({
      attachments: [{
        filename: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        local_path: '/tmp/report.pdf',
      }],
      unavailableCount: 2,
      totalCount: 3,
    });
    expect(forwardAttachmentStatus(plan))
      .toBe('已创建转发草稿，已带入 1 个附件；2 个附件尚未下载');
  });

  it('explains when every source attachment still needs downloading', () => {
    const plan = buildForwardAttachmentPlan([
      attachment({ is_downloaded: false, local_path: '' }),
    ]);

    expect(plan.attachments).toEqual([]);
    expect(forwardAttachmentStatus(plan))
      .toBe('已创建转发草稿；1 个附件尚未下载，未自动加入');
  });

  it('preserves the declared attachment count before metadata is available', () => {
    const plan = buildForwardAttachmentPlan([], 2);

    expect(plan).toEqual({
      attachments: [],
      unavailableCount: 2,
      totalCount: 2,
    });
    expect(forwardAttachmentStatus(plan))
      .toBe('已创建转发草稿；2 个附件尚未下载，未自动加入');
  });
});
