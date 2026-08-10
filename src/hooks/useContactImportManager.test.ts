import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useContactImportManager, { formatContactImportError } from './useContactImportManager';
import { invoke } from '../tauriBridge';
import type { ContactImportPreview } from '../app/types/contact';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

function previewFor(fileName: string, email: string): ContactImportPreview {
  return {
    path: `/mock/${fileName}`,
    file_name: fileName,
    format: 'vcard',
    total_count: 1,
    entries: [
      {
        email,
        name: 'Ada',
        aliases: [],
        vip: false,
        status: 'new',
        existing_contact_id: null,
        existing_name: '',
        reason: '新联系人',
      },
    ],
    new_count: 1,
    merge_count: 0,
    duplicate_count: 0,
    invalid_count: 0,
  };
}

function renderManager() {
  const setStatus = vi.fn();
  const utils = renderHook(() => useContactImportManager({ setStatus }));
  return { utils, setStatus };
}

describe('useContactImportManager import generation', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => cleanup());

  it('turns legacy UTF-8 errors into an actionable encoding message', () => {
    expect(formatContactImportError(new Error('联系人文件不是有效的 UTF-8 文本。')))
      .toBe('文件编码无法识别。请确认选择的是 vCard 或 CSV，并使用 UTF-8（推荐）或 GB18030 编码保存后再导入。');
  });

  it('previews a picked file and populates selection defaults', async () => {
    const { utils, setStatus } = renderManager();
    vi.mocked(invoke).mockImplementation((async (command: string) => {
      if (command === 'pick_contact_import_file') return '/mock/people.vcf';
      if (command === 'preview_contact_import') return previewFor('people.vcf', 'ada@example.com');
      return undefined;
    }) as never);

    await act(async () => {
      await utils.result.current.startImport();
    });

    expect(utils.result.current.preview?.file_name).toBe('people.vcf');
    expect(utils.result.current.importError).toBeNull();
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('已预览 people.vcf'));
  });

  it('surfaces parse failures inside the dialog without crashing', async () => {
    const { utils, setStatus } = renderManager();
    vi.mocked(invoke).mockImplementation((async (command: string) => {
      if (command === 'pick_contact_import_file') return '/mock/broken.csv';
      if (command === 'preview_contact_import') throw new Error('文件为空或格式无法识别。');
      return undefined;
    }) as never);

    await act(async () => {
      await utils.result.current.startImport();
    });

    expect(utils.result.current.importError).toContain('文件为空或格式无法识别');
    expect(utils.result.current.preview).toBeNull();
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('文件为空或格式无法识别'));
  });

  it('does not write stale preview results after cancel', async () => {
    const { utils } = renderManager();
    let resolvePick!: (path: string) => void;
    let resolvePreview!: (preview: ContactImportPreview) => void;
    const pickGate = new Promise<string>((resolve) => { resolvePick = resolve; });
    const previewGate = new Promise<ContactImportPreview>((resolve) => { resolvePreview = resolve; });
    vi.mocked(invoke).mockImplementation((async (command: string) => {
      if (command === 'pick_contact_import_file') return pickGate;
      if (command === 'preview_contact_import') return previewGate;
      return undefined;
    }) as never);

    const pending = utils.result.current.startImport();
    await act(async () => {
      utils.result.current.cancelImport();
      resolvePick('/mock/stale.vcf');
      resolvePreview(previewFor('stale.vcf', 'stale@example.com'));
      await pending;
    });

    // 关闭后旧 Promise 返回：不得回写任何状态。
    expect(utils.result.current.preview).toBeNull();
    expect(utils.result.current.importError).toBeNull();
    expect(utils.result.current.previewing).toBe(false);
  });

  it('does not let an old request overwrite a newer file preview', async () => {
    const { utils } = renderManager();
    let resolvePick1!: (path: string) => void;
    let resolvePick2!: (path: string) => void;
    let resolvePreview1!: (preview: ContactImportPreview) => void;
    let resolvePreview2!: (preview: ContactImportPreview) => void;
    const pick1 = new Promise<string>((resolve) => { resolvePick1 = resolve; });
    const pick2 = new Promise<string>((resolve) => { resolvePick2 = resolve; });
    const preview1 = new Promise<ContactImportPreview>((resolve) => { resolvePreview1 = resolve; });
    const preview2 = new Promise<ContactImportPreview>((resolve) => { resolvePreview2 = resolve; });
    let pickCalls = 0;
    let previewCalls = 0;
    vi.mocked(invoke).mockImplementation((async (command: string) => {
      if (command === 'pick_contact_import_file') return pickCalls++ === 0 ? pick1 : pick2;
      if (command === 'preview_contact_import') return previewCalls++ === 0 ? preview1 : preview2;
      return undefined;
    }) as never);

    // 第一次选择：文件框已返回路径，解析挂起中（旧请求仍在途）。
    const first = utils.result.current.startImport();
    await act(async () => {
      resolvePick1('/mock/seq-1.vcf');
      await Promise.resolve();
    });

    // 用户关闭（generation 递增）并重新选择第二个文件。
    utils.result.current.cancelImport();
    const second = utils.result.current.startImport();
    await act(async () => {
      resolvePick2('/mock/seq-2.vcf');
      await Promise.resolve();
    });

    // 旧解析结果先返回（必须被丢弃），新解析结果后返回（生效）。
    await act(async () => {
      resolvePreview1(previewFor('seq-1.vcf', 'seq-1@example.com'));
      resolvePreview2(previewFor('seq-2.vcf', 'seq-2@example.com'));
      await first;
      await second;
    });

    expect(utils.result.current.preview?.file_name).toBe('seq-2.vcf');
    expect(utils.result.current.preview?.entries[0]?.email).toBe('seq-2@example.com');
  });

  it('clears a completed session so the next open can select another file', async () => {
    const { utils } = renderManager();
    let pickCount = 0;
    let commitArgs: Record<string, unknown> | undefined;
    vi.mocked(invoke).mockImplementation((async (command: string, args?: Record<string, unknown>) => {
      if (command === 'pick_contact_import_file') {
        pickCount += 1;
        return pickCount === 1 ? '/mock/first.vcf' : '/mock/second.vcf';
      }
      if (command === 'preview_contact_import') {
        return previewFor(pickCount === 1 ? 'first.vcf' : 'second.vcf', pickCount === 1 ? 'first@example.com' : 'second@example.com');
      }
      if (command === 'commit_contact_import_entries') {
        commitArgs = args;
        return { batch_id: 1, created: 1, merged: 0, skipped: 0 };
      }
      if (command === 'list_contact_import_batches') return [];
      return undefined;
    }) as never);

    await act(async () => {
      await utils.result.current.startImport();
    });
    await act(async () => {
      await utils.result.current.commitImport();
    });
    expect(utils.result.current.commitResult?.created).toBe(1);
    expect(commitArgs?.fileName).toBe('first.vcf');
    expect(commitArgs?.file_name).toBeUndefined();

    act(() => utils.result.current.cancelImport());
    expect(utils.result.current.commitResult).toBeNull();
    expect(utils.result.current.preview).toBeNull();

    await act(async () => {
      await utils.result.current.startImport();
    });
    expect(utils.result.current.preview?.file_name).toBe('second.vcf');
  });
});
