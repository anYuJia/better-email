import { useEffect } from 'react';
import type { ProviderVerificationRecord } from '../app/types';
import type { SendUndoDelaySeconds } from '../app/appConfig';
import {
  notificationPolicyStorageKey,
  providerVerificationStorageKey,
  sendUndoDelayStorageKey,
} from '../app/appConfig';
import { saveMailboxListState } from '../app/mailboxListState';
import type { NotificationPolicy } from '../mailUtils';

type AppGlobalEffectsOptions = {
  notificationPolicy: NotificationPolicy;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  providerVerifications: Record<string, ProviderVerificationRecord>;
  folderId: number | null;
  mailboxListStateKey: string;
  messageLimit: number;
};

function isEmailDraftingInput(input: HTMLInputElement | HTMLTextAreaElement) {
  return input.classList.contains('composer-body') ||
    input.classList.contains('body-editor') ||
    input.closest('.composer-body-container') ||
    input.closest('.rich-text-editor') ||
    input.getAttribute('name') === 'body';
}

export default function useAppGlobalEffects({
  notificationPolicy,
  sendUndoDelaySeconds,
  providerVerifications,
  folderId,
  mailboxListStateKey,
  messageLimit,
}: AppGlobalEffectsOptions) {
  useEffect(() => {
    const handleFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;
      const isInput = target.tagName === 'INPUT';
      const isTextarea = target.tagName === 'TEXTAREA';
      if (isInput || isTextarea) {
        const input = target as HTMLInputElement | HTMLTextAreaElement;
        // Exclude email drafting body or main editor where spellcheck is desired
        if (!isEmailDraftingInput(input)) {
          input.setAttribute('autocorrect', 'off');
          input.setAttribute('autocapitalize', 'none');
          input.setAttribute('spellcheck', 'false');
          input.spellcheck = false;
        }
      }
    };
    document.addEventListener('focusin', handleFocus);
    return () => document.removeEventListener('focusin', handleFocus);
  }, []);

  useEffect(() => {
    function handleGlobalFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement) {
        (window as Window & { __focusedElement?: EventTarget | null }).__focusedElement = event.target;
      }
    }
    function handleGlobalBlur() {
      // Don't clear immediately to allow E2E tests to read it
    }
    document.addEventListener('focus', handleGlobalFocus, true);
    document.addEventListener('blur', handleGlobalBlur, true);
    return () => {
      document.removeEventListener('focus', handleGlobalFocus, true);
      document.removeEventListener('blur', handleGlobalBlur, true);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(notificationPolicyStorageKey, JSON.stringify(notificationPolicy));
  }, [notificationPolicy]);

  useEffect(() => {
    window.localStorage.setItem(sendUndoDelayStorageKey, String(sendUndoDelaySeconds));
  }, [sendUndoDelaySeconds]);

  useEffect(() => {
    window.localStorage.setItem(providerVerificationStorageKey, JSON.stringify(providerVerifications));
  }, [providerVerifications]);

  useEffect(() => {
    if (!folderId) return;
    saveMailboxListState(mailboxListStateKey, { limit: messageLimit });
  }, [folderId, mailboxListStateKey, messageLimit]);

  useEffect(() => {
    const dropdownSelector = [
      'details.compact-menu',
      'details.sidebar-disclosure',
      'details.composer-advanced',
      'details.settings-rule-advanced',
    ].join(',');

    function closestDropdown(target: EventTarget | null) {
      return target instanceof Element
        ? target.closest<HTMLDetailsElement>(dropdownSelector)
        : null;
    }

    function closeOpenDropdowns(except: HTMLDetailsElement | null = null) {
      document.querySelectorAll<HTMLDetailsElement>(`${dropdownSelector}[open]`).forEach((details) => {
        if (details !== except) details.open = false;
      });
    }

    function handleGlobalPointerDown(event: PointerEvent) {
      closeOpenDropdowns(closestDropdown(event.target));
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeOpenDropdowns();
    }

    document.addEventListener('pointerdown', handleGlobalPointerDown, true);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleGlobalPointerDown, true);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);
}
