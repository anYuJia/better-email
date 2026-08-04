import type { MockCommandHandler } from './types';
import {
  syncRuns,
  backgroundTasks,
  mockSyncSchedulePlan,
  runMockSyncCommand,
  enqueueMockBackgroundTask,
  markMockBackgroundTaskRunning,
  completeMockBackgroundTask,
  failMockBackgroundTask,
} from './state';

export const handlers: Record<string, MockCommandHandler> = {
  'list_sync_runs': () => syncRuns,
  'get_sync_schedule_plan': (args) => mockSyncSchedulePlan(args?.accountId),
  'run_sync_dry_run': (args) => runMockSyncCommand('run_sync_dry_run', args),
  'sync_imap_headers': (args) => runMockSyncCommand('sync_imap_headers', args),
  'sync_imap_history': (args) => runMockSyncCommand('sync_imap_history', args),
  'mark_frontend_ready': () => undefined,
  'mark_benchmark_sync_complete': () => undefined,
  'benchmark_sync_requested': () => false,
  'list_background_tasks': () => backgroundTasks,
  'enqueue_background_task': enqueueMockBackgroundTask,
  'next_background_task': () => (backgroundTasks
    .filter((task) => task.status === 'queued')
    .sort((left, right) => left.created_at.localeCompare(right.created_at))[0] ?? null),
  'mark_background_task_running': markMockBackgroundTaskRunning,
  'complete_background_task': completeMockBackgroundTask,
  'fail_background_task': failMockBackgroundTask,
};
