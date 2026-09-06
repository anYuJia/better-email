//! Better Email 所有运行日志的统一输出入口。
//!
//! 每条日志在**实际输出时**生成时间戳（本机时区 + 偏移），格式固定为：
//! `[YYYY-MM-DD HH:mm:ss.SSS ±HH:MM] [better-email][...] ...`
//!
//! Rust 端所有 `eprintln!`/`println!` 以及 `db_info`、`imap_info`、
//! `command_info` 等日志辅助函数都汇聚到 [`log_line`]，保证时间戳只出现一次、
//! 格式一致，且不会绕过统一入口单独打印。
//!
//! 前端 `src/app/logger.ts` 使用相同格式（`YYYY-MM-DD HH:mm:ss.SSS ±HH:MM`），
//! 两侧对同一行日志输出一致。

use std::io::Write;
use std::sync::Mutex;

/// 测试可替换的输出目标；`None` 表示输出到 stderr。
static LOG_WRITER: Mutex<Option<Box<dyn Write + Send>>> = Mutex::new(None);

#[cfg(test)]
thread_local! {
    static THREAD_LOG_WRITER: std::cell::RefCell<Option<Box<dyn Write>>> = const { std::cell::RefCell::new(None) };
}

/// 生成统一格式的时间戳：`2026-08-12 14:32:08.417 +08:00`。
fn format_timestamp(now: chrono::DateTime<chrono::Local>) -> String {
    now.format("%Y-%m-%d %H:%M:%S%.3f %:z").to_string()
}

/// 为日志正文生成完整的一行（含时间戳前缀）。
pub fn format_line(message: &str) -> String {
    format!("[{}] {}", format_timestamp(chrono::Local::now()), message)
}

/// 统一日志入口：在输出时生成时间戳并写入 stderr（测试时可替换输出目标）。
pub fn log_line(message: impl AsRef<str>) {
    let line = format_line(message.as_ref());
    #[cfg(test)]
    {
        let handled = THREAD_LOG_WRITER.with(|cell| {
            let mut borrow = cell.borrow_mut();
            if let Some(writer) = borrow.as_mut() {
                let _ = writeln!(writer, "{line}");
                true
            } else {
                false
            }
        });
        if handled {
            return;
        }
    }
    let mut writer = LOG_WRITER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match writer.as_mut() {
        Some(writer) => {
            let _ = writeln!(writer, "{line}");
        }
        None => eprintln!("{line}"),
    }
}

#[cfg(test)]
pub(crate) fn set_log_writer(writer: Option<Box<dyn Write + Send>>) {
    let mut guard = LOG_WRITER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = writer;
}

/// 测试工具：把日志输出捕获到内存缓冲。断言应使用 `contains`/`any`，
/// 因为并行测试中其他经由 [`log_line`] 的日志行也可能进入同一缓冲。
#[cfg(test)]
pub(crate) mod test_util {
    use super::set_log_writer;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    /// 串行化所有需要捕获日志输出的测试，避免并行测试抢占全局输出目标。
    static CAPTURE_LOCK: Mutex<()> = Mutex::new(());

    #[derive(Clone)]
    pub(crate) struct CaptureWriter(Arc<Mutex<Vec<u8>>>);

    impl Write for CaptureWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// 在内存缓冲中捕获 `action` 期间的所有日志输出，返回捕获文本。
    pub(crate) fn with_capture(action: impl FnOnce()) -> String {
        let _guard = CAPTURE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let capture = CaptureWriter(Arc::new(Mutex::new(Vec::new())));
        super::THREAD_LOG_WRITER.with(|cell| *cell.borrow_mut() = Some(Box::new(capture.clone())));
        set_log_writer(Some(Box::new(capture.clone())));
        action();
        set_log_writer(None);
        super::THREAD_LOG_WRITER.with(|cell| *cell.borrow_mut() = None);
        let bytes = capture.0.lock().unwrap_or_else(|p| p.into_inner()).clone();
        String::from_utf8(bytes).expect("captured logs are utf8")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logging::test_util;

    /// 从一行日志中取出 `[...]` 时间戳前缀。
    fn parse_timestamp(line: &str) -> Option<&str> {
        line.strip_prefix('[')?.split_once("] ")?.0.into()
    }

    /// 校验时间戳符合 `YYYY-MM-DD HH:mm:ss.SSS ±HH:MM`。
    fn timestamp_matches_shape(stamp: &str) -> bool {
        let mut parts = stamp.split(' ');
        let (Some(date), Some(time), Some(offset), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return false;
        };
        // YYYY-MM-DD
        let date_ok = date.len() == 10
            && date.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 {
                    c == '-'
                } else {
                    c.is_ascii_digit()
                }
            });
        // HH:MM:SS.SSS
        let time_ok = time.len() == 12
            && time.chars().enumerate().all(|(i, c)| match i {
                2 | 5 => c == ':',
                8 => c == '.',
                _ => c.is_ascii_digit(),
            });
        // ±HH:MM
        let offset_ok = offset.len() == 6
            && offset.chars().enumerate().all(|(i, c)| {
                if i == 3 {
                    c == ':'
                } else if i == 0 {
                    c == '+' || c == '-'
                } else {
                    c.is_ascii_digit()
                }
            });
        date_ok && time_ok && offset_ok
    }

    #[test]
    fn format_line_prefixes_a_timestamp() {
        let line = format_line("hello world");
        let stamp = parse_timestamp(&line).unwrap_or_else(|| panic!("缺少时间戳前缀：{line}"));
        assert!(
            timestamp_matches_shape(stamp),
            "时间戳格式不符：{stamp:?}（行：{line}）"
        );
        assert!(line.ends_with("hello world"), "日志正文丢失：{line}");
    }

    #[test]
    fn log_lines_are_timestamped_via_unified_entry() {
        let text = test_util::with_capture(|| {
            log_line("[better-email][db] open ok");
            log_line("[better-email][sync] plan account_id=Some(1) total_accounts=1");
            log_line("[better-email][sync] command failed error=boom");
        });
        let lines: Vec<&str> = text.lines().collect();
        let targets = [
            "[better-email][db] open ok",
            "[better-email][sync] plan account_id=Some(1) total_accounts=1",
            "[better-email][sync] command failed error=boom",
        ];
        for target in targets {
            let line = lines
                .iter()
                .copied()
                .find(|line| line.ends_with(target))
                .unwrap_or_else(|| panic!("缺少日志行：{target}，实际输出：{text}"));
            let stamp = parse_timestamp(line).unwrap_or_else(|| panic!("缺少时间戳前缀：{line}"));
            assert!(
                timestamp_matches_shape(stamp),
                "时间戳格式不符：{stamp:?}（行：{line}）"
            );
        }
    }

    #[test]
    fn timestamps_are_generated_at_output_time() {
        // 每次输出都应生成独立的时间戳，而不是复用调用方缓存的时间。
        let text = test_util::with_capture(|| {
            log_line("first");
            log_line("second");
        });
        let first_line = text
            .lines()
            .find(|line| line.ends_with("first"))
            .unwrap_or_else(|| panic!("缺少 first 日志行：{text}"));
        let second_line = text
            .lines()
            .find(|line| line.ends_with("second"))
            .unwrap_or_else(|| panic!("缺少 second 日志行：{text}"));
        let first_stamp = parse_timestamp(first_line)
            .unwrap_or_else(|| panic!("缺少 first 时间戳：{first_line}"));
        let second_stamp = parse_timestamp(second_line)
            .unwrap_or_else(|| panic!("缺少 second 时间戳：{second_line}"));
        assert!(
            timestamp_matches_shape(first_stamp),
            "第一条时间戳格式不符：{first_stamp}"
        );
        assert!(
            timestamp_matches_shape(second_stamp),
            "第二条时间戳格式不符：{second_stamp}"
        );
        assert!(
            first_stamp <= second_stamp,
            "第二次输出的时间戳不应早于第一次：{first_stamp} vs {second_stamp}"
        );
    }
}
