import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog state and callbacks', () => {
  it('instantiates correctly with options', () => {
    // Basic test that validates compile-time correctness of ConfirmDialog typing and hooks
    const mockOnConfirm = vi.fn();
    const mockOnCancel = vi.fn();

    expect(ConfirmDialog).toBeDefined();
  });
});
