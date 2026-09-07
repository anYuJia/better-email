use super::*;
use std::sync::{Arc, Barrier};

fn fixture() -> (tempfile::TempDir, MailStore, MailStore) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tasks.sqlite3");
    let first = MailStore::open_at_with_seed(path.clone(), false).unwrap();
    let second = MailStore::open_at_with_seed(path, false).unwrap();
    (dir, first, second)
}

fn input(kind: &str, account_id: Option<i64>) -> BackgroundTaskInput {
    BackgroundTaskInput {
        kind: kind.into(),
        source: "manual".into(),
        account_id,
    }
}

#[test]
fn concurrent_connections_enqueue_one_active_task_per_scope() {
    let (_dir, first, second) = fixture();
    let barrier = Arc::new(Barrier::new(16));
    let workers: Vec<_> = (0..16)
        .map(|index| {
            let store = if index % 2 == 0 {
                first.clone()
            } else {
                second.clone()
            };
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .enqueue_background_task(input("sync", Some(42)))
                    .unwrap()
                    .id
            })
        })
        .collect();
    let ids: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert!(ids.iter().all(|id| *id == ids[0]));
    assert_eq!(first.list_background_tasks().unwrap().len(), 1);
}

#[test]
fn retry_reuses_newer_active_task_instead_of_resurrecting_failed_work() {
    let (_dir, first, second) = fixture();
    let old = first
        .enqueue_background_task(input("sync", Some(42)))
        .unwrap();
    first.mark_background_task_running(old.id).unwrap();
    first.fail_background_task(old.id, "offline").unwrap();
    let active = second
        .enqueue_background_task(input("sync", Some(42)))
        .unwrap();
    let retried = first.retry_background_task(old.id).unwrap();
    assert_eq!(retried.id, active.id);
    assert_eq!(
        first.get_background_task_by_id(old.id).unwrap().status,
        "failed"
    );
}

#[test]
fn concurrent_retry_and_enqueue_share_the_same_active_task() {
    let (_dir, first, second) = fixture();
    let old = first.enqueue_background_task(input("sync", None)).unwrap();
    first.cancel_background_task(old.id).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let other_barrier = barrier.clone();
    let retry = std::thread::spawn(move || {
        other_barrier.wait();
        first.retry_background_task(old.id).unwrap().id
    });
    barrier.wait();
    let enqueued = second.enqueue_background_task(input("sync", None)).unwrap();
    assert_eq!(retry.join().unwrap(), enqueued.id);
}

#[test]
fn deduplication_keeps_accounts_and_task_kinds_independent() {
    let (_dir, first, _) = fixture();
    for (kind, account) in [
        ("sync", None),
        ("sync", Some(1)),
        ("sync", Some(2)),
        ("outbox-smtp", Some(1)),
    ] {
        first.enqueue_background_task(input(kind, account)).unwrap();
    }
    assert_eq!(first.list_background_tasks().unwrap().len(), 4);
}

#[test]
fn active_tasks_remain_visible_after_many_newer_terminal_tasks() {
    let (_dir, first, _) = fixture();
    let queued = first
        .enqueue_background_task(input("outbox-smtp", None))
        .unwrap();
    let running = first
        .enqueue_background_task(input("outbox-dry-run", None))
        .unwrap();
    first.mark_background_task_running(running.id).unwrap();
    for _ in 0..25 {
        let task = first.enqueue_background_task(input("sync", None)).unwrap();
        first.mark_background_task_running(task.id).unwrap();
        first.complete_background_task(task.id, "done").unwrap();
    }
    let tasks = first.list_background_tasks().unwrap();
    assert_eq!(tasks.len(), 12);
    assert!(tasks
        .iter()
        .any(|task| task.id == queued.id && task.status == "queued"));
    assert!(tasks
        .iter()
        .any(|task| task.id == running.id && task.status == "running"));
    assert_eq!(
        tasks.iter().filter(|task| task.status == "done").count(),
        10
    );
}

#[test]
fn progress_is_bounded_monotonic_and_does_not_replace_cancellation() {
    let (_dir, first, _) = fixture();
    let task = first.enqueue_background_task(input("sync", None)).unwrap();
    first.mark_background_task_running(task.id).unwrap();
    assert_eq!(
        first
            .update_background_task_progress(task.id, -10, "start")
            .unwrap()
            .progress,
        0
    );
    first
        .update_background_task_progress(task.id, 60, "newer")
        .unwrap();
    let stale = first
        .update_background_task_progress(task.id, 20, "late")
        .unwrap();
    assert_eq!(stale.progress, 60);
    assert_eq!(stale.message, "newer");
    let capped = first
        .update_background_task_progress(task.id, 500, "end")
        .unwrap();
    assert_eq!(capped.progress, 100);
    first.cancel_background_task(task.id).unwrap();
    let cancelled = first
        .update_background_task_progress(task.id, 100, "late")
        .unwrap();
    assert!(cancelled.cancel_requested);
    assert_eq!(cancelled.message, "正在取消…");
    assert!(first.consume_background_task_cancel(task.id).unwrap());
    assert!(!first.consume_background_task_cancel(task.id).unwrap());
}

#[test]
fn cancellation_does_not_downgrade_a_completed_task() {
    let (_dir, first, second) = fixture();
    let task = first.enqueue_background_task(input("sync", None)).unwrap();
    first.mark_background_task_running(task.id).unwrap();
    first.complete_background_task(task.id, "finished").unwrap();
    let unchanged = second.cancel_background_task(task.id).unwrap();
    assert_eq!(unchanged.status, "done");
    assert_eq!(unchanged.message, "finished");
    assert!(!unchanged.cancel_requested);
    assert!(!second.consume_background_task_cancel(task.id).unwrap());
}

#[test]
fn retry_without_active_replacement_resets_progress_and_timestamps() {
    let (_dir, first, _) = fixture();
    let task = first.enqueue_background_task(input("sync", None)).unwrap();
    first.mark_background_task_running(task.id).unwrap();
    first
        .update_background_task_progress(task.id, 60, "partial")
        .unwrap();
    first.fail_background_task(task.id, "offline").unwrap();
    let retried = first.retry_background_task(task.id).unwrap();
    assert_eq!(retried.id, task.id);
    assert_eq!(retried.status, "queued");
    assert_eq!(retried.progress, 0);
    assert!(retried.started_at.is_empty() && retried.finished_at.is_empty());
}

#[test]
fn task_queries_use_partial_indexes_instead_of_scanning_terminal_history() {
    let (_dir, store, _) = fixture();
    store
        .with_conn(|conn| {
            let scope_plan: String = conn.query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM background_tasks
             WHERE kind = 'sync' AND status IN ('queued', 'running')
               AND COALESCE(account_id, 0) = 42
             ORDER BY created_at ASC, id ASC LIMIT 1",
                [],
                |row| row.get(3),
            )?;
            assert!(
                scope_plan.contains("idx_background_tasks_active_scope"),
                "{scope_plan}"
            );
            let history_plan: String = conn.query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM background_tasks
             WHERE status NOT IN ('queued', 'running')
             ORDER BY created_at DESC, id DESC LIMIT 10",
                [],
                |row| row.get(3),
            )?;
            assert!(
                history_plan.contains("idx_background_tasks_terminal_history"),
                "{history_plan}"
            );
            Ok(())
        })
        .unwrap();
}
