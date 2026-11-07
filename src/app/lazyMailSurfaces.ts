import { lazy } from 'react';

const loadComposerWindow = () => import('../components/ComposerWindow');
export const ComposerWindow = lazy(loadComposerWindow);
export const preloadComposerWindow = () => { void loadComposerWindow().catch(() => undefined); };
export const SnoozePicker = lazy(() => import('../components/SnoozePicker'));
export const ShortcutHelpModal = lazy(() => import('../components/ShortcutHelpModal'));
export const FirstRunOnboarding = lazy(() => import('../components/FirstRunOnboarding'));
export const AccountLoginDialog = lazy(() => import('../components/AccountLoginDialog'));
export const ComposerCloseConfirmDialog = lazy(() => import('../components/ComposerCloseConfirmDialog'));
export const ConfirmationDialogs = lazy(() => import('../components/ConfirmationDialogs'));
export const UndoSnackbarStack = lazy(() => import('../components/UndoSnackbarStack'));
export const MessageToastStack = lazy(() => import('../components/MessageToastStack'));
