import { invoke } from './tauriBridge';
import { IPC } from './ipc/commands';

export type StartupMilestone =
  | 'main_react_entry'
  | 'app_root_mount'
  | 'app_shell_mount'
  | 'app_shell_first_painted'
  | 'mailbox_metadata_ready'
  | 'first_message_list_query_complete'
  | 'first_message_row_painted';

const reportedMilestones = new Set<StartupMilestone>();
const startupIpcAvailable = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && import.meta.env.VITE_BETTER_EMAIL_UI_MOCK !== '1'
  && import.meta.env.VITE_SWIFTMAIL_UI_MOCK !== '1';

/**
 * Startup timing is intentionally fire-and-forget. The browser performance
 * mark is local and immediate; the optional Rust IPC only records diagnostics
 * and can never hold up rendering or the window reveal.
 */
export function reportStartupMilestone(milestone: StartupMilestone): Promise<void> {
  if (reportedMilestones.has(milestone)) return Promise.resolve();
  reportedMilestones.add(milestone);

  try {
    performance.mark(`better-email:${milestone}`);
  } catch {
    // Diagnostics must remain safe in test/webview environments without marks.
  }

  if (!startupIpcAvailable) return Promise.resolve();
  return invoke<void>(IPC.RecordStartupMilestone, { milestone }).catch(() => undefined);
}
