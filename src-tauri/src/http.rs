//! 共享的不可信 HTTP 响应读取工具。
//!
//! 所有外部 HTTP 响应（AI/MCP/OAuth token 端点等）都必须经此有上限读取，
//! 绝不对恶意超大响应先整体 read_to_string 再截断。

use std::io::Read;

/// 有上限地读取不可信 HTTP 响应正文：最多读取 `max_bytes + 1` 字节，
/// 超过上限即拒绝，错误信息不包含响应内容。
pub(crate) fn read_response_capped(reader: impl Read, max_bytes: u64) -> Result<String, String> {
    let mut raw = String::new();
    reader
        .take(max_bytes + 1)
        .read_to_string(&mut raw)
        .map_err(|error| format!("服务响应读取失败：{error}"))?;
    if raw.len() as u64 > max_bytes {
        return Err("服务响应超过大小上限，已拒绝读取。".to_string());
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::read_response_capped;

    #[test]
    fn small_responses_read_normally() {
        let small =
            read_response_capped(&b"{\"ok\":true}"[..], 2 * 1024 * 1024).expect("small read");
        assert_eq!(small, "{\"ok\":true}");
    }

    #[test]
    fn oversized_responses_are_rejected_without_buffering_whole_body() {
        let max: u64 = 4096;
        let big = vec![b'x'; max as usize + 10];
        let err = read_response_capped(&big[..], max).expect_err("oversized rejected");
        assert!(
            err.contains("超过大小上限"),
            "超大响应应在读取阶段被拒绝：{err}"
        );
        // 错误信息不得包含响应内容。
        assert!(!err.contains('x'), "错误信息不得包含响应正文：{err}");
    }
}
