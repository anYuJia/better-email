//! MIME text decoding helpers.
//!
//! Everything here works on raw bytes whenever possible so that non-UTF-8
//! legacy charsets (GBK, GB2312, GB18030, Big5, ...) are decoded from their
//! original bytes instead of being permanently corrupted by `from_utf8_lossy`.
//!
//! Supported inputs:
//! - RFC 2047 encoded-words: `=?charset?B?...?=` and `=?charset?Q?...?=`
//! - RFC 2231 / RFC 5987 parameter values: `filename*=charset''percent`
//! - Raw body bytes combined with a declared charset + Content-Transfer-Encoding

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use encoding_rs::Encoding;
use std::borrow::Cow;

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn strip_utf8_bom(bytes: &[u8]) -> &[u8] {
    if bytes.len() >= 3 && bytes[..3] == [0xEF, 0xBB, 0xBF] {
        &bytes[3..]
    } else {
        bytes
    }
}

/// Normalize a charset label: trim whitespace and surrounding quotes,
/// drop RFC 2231 language suffixes (`UTF-8*de` -> `UTF-8`).
fn normalize_charset_label(label: &str) -> String {
    label
        .trim()
        .trim_matches(['"', '\''])
        .split('*')
        .next()
        .unwrap_or(label)
        .trim()
        .to_string()
}

/// Decode bytes using the declared charset, with a safe fallback chain:
/// valid UTF-8 always wins, then the declared charset, then GB18030
/// (a superset of GBK/GB2312), and only as a last resort UTF-8 lossy.
pub fn decode_bytes_with_charset(bytes: &[u8], charset: &str) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let bytes = strip_utf8_bom(bytes);
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }

    let label = normalize_charset_label(charset);
    let Some(encoding) = Encoding::for_label(label.as_bytes()) else {
        return decode_unknown_charset(bytes);
    };
    let (decoded, _, had_errors) = encoding.decode(bytes);
    if !had_errors {
        return decoded.into_owned();
    }
    if encoding != encoding_rs::GB18030 {
        let (gb18030, _, gb_errors) = encoding_rs::GB18030.decode(bytes);
        if !gb_errors {
            return gb18030.into_owned();
        }
    }
    decoded.into_owned()
}

fn decode_unknown_charset(bytes: &[u8]) -> String {
    let (gb18030, _, gb_errors) = encoding_rs::GB18030.decode(bytes);
    if !gb_errors {
        return gb18030.into_owned();
    }
    // Absolute last resort: lossy UTF-8 replacement.
    String::from_utf8_lossy(bytes).into_owned()
}

/// Decode a single RFC 2047 encoded-word at `start` (pointing at `=`).
/// Returns the decoded text and the offset just past the closing `?=`.
fn decode_encoded_word_at(bytes: &[u8], start: usize) -> Option<(String, usize)> {
    let after = start + 2;
    let charset_end = bytes[after..].iter().position(|&b| b == b'?')? + after;
    if charset_end == after || charset_end + 3 >= bytes.len() {
        return None;
    }
    let charset = std::str::from_utf8(&bytes[after..charset_end]).ok()?;
    let encoding = bytes[charset_end + 1];
    // Data starts after the encoding letter and its trailing '?'.
    let data_start = charset_end + 3;
    let data_end = find_subsequence(&bytes[data_start..], b"?=")? + data_start;
    let raw = match encoding {
        b'B' | b'b' => {
            decode_base64_loose(std::str::from_utf8(&bytes[data_start..data_end]).ok()?)?
        }
        b'Q' | b'q' => decode_quoted_printable_word(&bytes[data_start..data_end]),
        _ => return None,
    };
    let decoded = decode_bytes_with_charset(&raw, charset);
    Some((decoded, data_end + 2))
}

fn consume_whitespace(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() && matches!(bytes[index], b' ' | b'\t' | b'\r' | b'\n') {
        index += 1;
    }
    index
}

/// Decode RFC 2047 encoded-words anywhere in `value`.
///
/// - Multiple adjacent encoded-words (with or without intervening linear
///   whitespace) are concatenated without a space.
/// - Whitespace between an encoded-word and plain text is preserved.
/// - Malformed words are left untouched; this never panics.
pub fn decode_rfc2047(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'=' && bytes.get(index + 1) == Some(&b'?') {
            if let Some((decoded, next)) = decode_encoded_word_at(bytes, index) {
                output.push_str(&decoded);
                index = next;
                let after_whitespace = consume_whitespace(bytes, index);
                if bytes.get(after_whitespace) == Some(&b'=')
                    && bytes.get(after_whitespace + 1) == Some(&b'?')
                {
                    index = after_whitespace;
                    continue;
                }
                // Not another word: keep the linear whitespace before plain text.
                output.push_str(&value[index..after_whitespace]);
                index = after_whitespace;
                continue;
            }
        }
        let ch = value[index..].chars().next().unwrap_or(' ');
        output.push(ch);
        index += ch.len_utf8();
    }
    output
}

fn contains_encoded_word(value: &str) -> bool {
    value.contains("=?") && value.contains("?=")
}

/// Decode an RFC 2047 encoded-word subject/display-name value.
///
/// Idempotent: values that contain no encoded-word (including plain Chinese
/// text or already-decoded UTF-8) are returned unchanged.
pub fn decode_mime_header_value(value: &str) -> String {
    let trimmed = value.trim();
    if !contains_encoded_word(trimmed) {
        return trimmed.to_string();
    }
    decode_rfc2047(trimmed)
}

/// Decode an RFC 2047 encoded-word inside an address header value.
///
/// Idempotent: plain address lists are returned unchanged. Only the
/// encoded-word segments are decoded, the `Name <email>` structure is kept.
pub fn decode_address_header_value(value: &str) -> String {
    let trimmed = value.trim();
    if !contains_encoded_word(trimmed) {
        return trimmed.to_string();
    }
    decode_rfc2047(trimmed)
}

/// Decode a parameter value used for attachment filenames.
///
/// Handles RFC 2047 encoded-words, percent-encoded (RFC 5987 style) values,
/// and passes through plain names untouched.
pub fn decode_attachment_filename(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"');
    if contains_encoded_word(trimmed) {
        return decode_rfc2047(trimmed);
    }
    if trimmed.contains('%') {
        let bytes = percent_decode(trimmed);
        let decoded = decode_bytes_with_charset(&bytes, "utf-8");
        if decoded != trimmed && !decoded.contains('\u{FFFD}') {
            return decoded;
        }
    }
    trimmed.to_string()
}

/// Percent-decode an RFC 2231 / RFC 5987 extended parameter value.
pub fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && matches!(
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])),
                (Some(_), Some(_))
            )
        {
            let high = hex_value(bytes[index + 1]).unwrap();
            let low = hex_value(bytes[index + 2]).unwrap();
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    output
}

/// Percent-decode then charset-decode an RFC 2231 extended value.
pub fn percent_decode_charset(data: &str, charset: &str) -> String {
    decode_bytes_with_charset(&percent_decode(data), charset)
}

/// Split an RFC 2231 extended value `charset'language'percent-encoded` into
/// `(charset, data)`.
pub fn split_rfc2231_extended(value: &str) -> Option<(String, String)> {
    let (charset, rest) = value.split_once('\'')?;
    let (_language, data) = rest.split_once('\'')?;
    Some((charset.trim().to_string(), data.to_string()))
}

/// Resolve an attachment filename from Content-Disposition / Content-Type
/// parameters, honoring:
/// - RFC 2231 continuations: `filename*0*=`, `filename*1*=`, ...
/// - RFC 2231 / RFC 5987 extended values: `filename*=charset''percent`
/// - RFC 2047 encoded-words in plain `filename="=?GBK?B?...?="` values
/// - plain `filename` / `name` values (passed through unchanged)
pub fn decode_rfc2231_params(params: &[(Cow<'_, str>, Cow<'_, str>)]) -> Option<String> {
    let mut plain: Option<String> = None;
    let mut extended: Option<(String, String)> = None;
    let mut continuations: Vec<(usize, bool, String)> = Vec::new();

    for (key, value) in params {
        let key_lower = key.to_ascii_lowercase();
        if key_lower == "filename" || key_lower == "name" {
            plain = Some(decode_attachment_filename(value));
        } else if key_lower == "filename*" || key_lower == "name*" {
            if let Some((charset, data)) = split_rfc2231_extended(value) {
                extended = Some((charset, data));
            }
        } else if let Some(suffix) = key_lower
            .strip_prefix("filename*")
            .or_else(|| key_lower.strip_prefix("name*"))
        {
            let is_extended = suffix.contains('*');
            let index_text = suffix.split('*').next().unwrap_or(suffix);
            if let Ok(index) = index_text.parse::<usize>() {
                continuations.push((index, is_extended, value.to_string()));
            }
        }
    }

    if !continuations.is_empty() {
        continuations.sort_by_key(|(index, _, _)| *index);
        let mut charset = String::new();
        let mut decoded = String::new();
        for (_, is_extended, segment) in continuations {
            if is_extended {
                let (segment_charset, data) = if charset.is_empty() {
                    split_rfc2231_extended(&segment)
                        .unwrap_or_else(|| (String::new(), segment.clone()))
                } else {
                    (String::new(), segment)
                };
                if charset.is_empty() {
                    charset = segment_charset;
                }
                decoded.push_str(&percent_decode_charset(&data, &charset));
            } else {
                decoded.push_str(&segment);
            }
        }
        return Some(decoded);
    }

    if let Some((charset, data)) = extended {
        return Some(percent_decode_charset(&data, &charset));
    }

    plain
}

fn decode_base64_loose(data: &str) -> Option<Vec<u8>> {
    let compact = data
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    // Some real-world senders emit padding that is off by a character;
    // strip existing padding and re-add the exact amount required.
    let stripped = compact.trim_end_matches('=');
    let mut padded = stripped.to_string();
    let remainder = padded.len() % 4;
    if remainder != 0 {
        padded.push_str(&"=".repeat(4 - remainder));
    }
    STANDARD.decode(padded.as_bytes()).ok()
}

/// Decode a Q-encoded-word payload: `_` -> space, `=XX` -> byte.
fn decode_quoted_printable_word(data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len());
    let mut index = 0;
    while index < data.len() {
        match data[index] {
            b'_' => {
                output.push(b' ');
                index += 1;
            }
            b'=' if index + 2 < data.len()
                && matches!(
                    (hex_value(data[index + 1]), hex_value(data[index + 2])),
                    (Some(_), Some(_))
                ) =>
            {
                let high = hex_value(data[index + 1]).unwrap();
                let low = hex_value(data[index + 2]).unwrap();
                output.push((high << 4) | low);
                index += 3;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    output
}

/// Decode a quoted-printable encoded body: `=XX` -> byte, `=\r\n` soft breaks
/// are removed, anything else is kept verbatim.
pub fn decode_quoted_printable_body(data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len());
    let mut index = 0;
    while index < data.len() {
        if data[index] == b'=' {
            if data.get(index + 1) == Some(&b'\r') && data.get(index + 2) == Some(&b'\n') {
                index += 3;
                continue;
            }
            if data.get(index + 1) == Some(&b'\n') {
                index += 2;
                continue;
            }
            if index + 2 < data.len()
                && matches!(
                    (hex_value(data[index + 1]), hex_value(data[index + 2])),
                    (Some(_), Some(_))
                )
            {
                let high = hex_value(data[index + 1]).unwrap();
                let low = hex_value(data[index + 2]).unwrap();
                output.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        output.push(data[index]);
        index += 1;
    }
    output
}

/// Decode a body byte slice given its declared Content-Transfer-Encoding and
/// charset. Base64 and quoted-printable are decoded before charset decoding.
/// Unknown charsets fall back to UTF-8 -> GB18030 -> lossy.
pub fn decode_body_text(
    body: &[u8],
    transfer_encoding: Option<&str>,
    charset: Option<&str>,
) -> String {
    if body.is_empty() {
        return String::new();
    }
    let decoded = match transfer_encoding
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "base64" => {
            let text = String::from_utf8_lossy(body);
            match decode_base64_loose(&text) {
                Some(bytes) => bytes,
                None => body.to_vec(),
            }
        }
        "quoted-printable" => decode_quoted_printable_body(body),
        _ => body.to_vec(),
    };
    decode_bytes_with_charset(&decoded, charset.unwrap_or("utf-8"))
}

/// Split raw message bytes into `(header, body)` at the first blank line.
pub fn split_header_body(raw: &[u8]) -> (&[u8], &[u8]) {
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'\n' {
            if index >= 1
                && raw[index - 1] == b'\r'
                && raw.get(index + 1) == Some(&b'\r')
                && raw.get(index + 2) == Some(&b'\n')
            {
                return (&raw[..index - 1], &raw[index + 3..]);
            }
            if raw.get(index + 1) == Some(&b'\n') {
                return (&raw[..index], &raw[index + 2..]);
            }
        }
        index += 1;
    }
    (raw, &[])
}

/// Extract unfolded header fields `(lowercased_name, raw_value_bytes)` from a
/// raw header block, preserving non-UTF-8 bytes for charset decoding later.
pub fn extract_header_fields(raw: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut fields: Vec<(String, Vec<u8>)> = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_value: Vec<u8> = Vec::new();

    for line in raw.split(|&byte| byte == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.is_empty() {
            break;
        }
        if line
            .first()
            .is_some_and(|byte| *byte == b' ' || *byte == b'\t')
        {
            if current_name.is_some() {
                let continuation = trim_ascii_bytes(line);
                if !continuation.is_empty() {
                    if !current_value.is_empty() {
                        current_value.push(b' ');
                    }
                    current_value.extend_from_slice(continuation);
                }
            }
            continue;
        }
        if let Some(name) = current_name.take() {
            fields.push((name, std::mem::take(&mut current_value)));
        }
        let Some(colon) = line.iter().position(|&byte| byte == b':') else {
            continue;
        };
        current_name = Some(
            std::str::from_utf8(&line[..colon])
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase(),
        );
        current_value = line[colon + 1..].to_vec();
    }
    if let Some(name) = current_name.take() {
        fields.push((name, current_value));
    }
    fields
}

fn trim_ascii_bytes(mut value: &[u8]) -> &[u8] {
    while value.first().is_some_and(|byte| byte.is_ascii_whitespace()) {
        value = &value[1..];
    }
    while value.last().is_some_and(|byte| byte.is_ascii_whitespace()) {
        value = &value[..value.len() - 1];
    }
    value
}

/// Decode a header value's raw bytes: ASCII values are returned directly,
/// non-ASCII bytes go through the UTF-8 -> GB18030 -> lossy chain, and any
/// RFC 2047 encoded-words inside are decoded afterwards.
pub fn decode_header_value_bytes(value: &[u8]) -> String {
    if value.iter().all(|byte| byte.is_ascii()) {
        let text = String::from_utf8_lossy(value).into_owned();
        return decode_mime_header_value(&text);
    }
    let text = decode_bytes_with_charset(value, "gb18030");
    decode_mime_header_value(&text)
}

/// Extract the `charset=` parameter from a raw Content-Type header value.
pub fn charset_from_content_type(value: &[u8]) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    let needle = b"charset=";
    let position = find_subsequence(&lower, needle)?;
    let rest = &value[position + needle.len()..];
    let end = rest
        .iter()
        .position(|&byte| byte == b';')
        .unwrap_or(rest.len());
    let label = String::from_utf8_lossy(&rest[..end])
        .trim()
        .trim_matches(['"', '\''])
        .to_string();
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

/// Read the Content-Transfer-Encoding value from extracted header fields.
pub fn content_transfer_encoding(fields: &[(String, Vec<u8>)]) -> Option<String> {
    fields
        .iter()
        .find(|(name, _)| name == "content-transfer-encoding")
        .map(|(_, value)| String::from_utf8_lossy(value).trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

/// Extract the `charset=` parameter from the Content-Type field.
pub fn content_type_charset(fields: &[(String, Vec<u8>)]) -> Option<String> {
    fields
        .iter()
        .find(|(name, _)| name == "content-type")
        .and_then(|(_, value)| charset_from_content_type(value))
}

/// Case-insensitive ASCII substring search on raw bytes.
pub fn contains_ascii_case_insensitive(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return false;
    }
    haystack
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    const UTF8_B_SUBJECT: &str =
        "=?UTF-8?B?55So5oi35pWw5o2u6K6h566X6L+H56iLMjbml6U35pyI5rGH5oC7ICgxKQ==?=";
    const GBK_B_SUBJECT: &str = "=?GBK?B?08O7p8r9vt28xsvjuf2zzDI2yNU31MK749fcICgxKQ==?=";
    const GB2312_Q_SUBJECT: &str =
        "=?GB2312?Q?=D3=C3=BB=A7=CA=FD=BE=DD=BC=C6=CB=E3=B9=FD=B3=CC26=C8=D57=D4=C2=BB=E3=D7=DC=20(1)?=";
    const EXPECTED_SUBJECT: &str = "用户数据计算过程26日7月汇总 (1)";

    #[test]
    fn decodes_utf8_b_encoded_subject() {
        assert_eq!(decode_mime_header_value(UTF8_B_SUBJECT), EXPECTED_SUBJECT);
    }

    #[test]
    fn decodes_gbk_b_encoded_subject() {
        assert_eq!(decode_mime_header_value(GBK_B_SUBJECT), EXPECTED_SUBJECT);
    }

    #[test]
    fn decodes_gb2312_q_encoded_subject() {
        assert_eq!(decode_mime_header_value(GB2312_Q_SUBJECT), EXPECTED_SUBJECT);
    }

    #[test]
    fn decodes_gb18030_encoded_subject() {
        // "用户数据" GB18030 B-encoded (GB18030 superset of GBK bytes).
        let gb18030 = "=?GB18030?B?08O7p8r9vt0=?=";
        assert_eq!(decode_mime_header_value(gb18030), "用户数据");
    }

    #[test]
    fn decodes_chinese_sender_name() {
        assert_eq!(
            decode_address_header_value("=?utf-8?B?5byg5YGl?= <zhang@example.com>"),
            "张健 <zhang@example.com>"
        );
        assert_eq!(
            decode_address_header_value("=?GBK?B?wO7Hvw==?= <li@example.com>"),
            "李强 <li@example.com>"
        );
    }

    #[test]
    fn merges_adjacent_encoded_words_without_whitespace() {
        let input = "=?UTF-8?B?55So5oi35pWw5o2u?==?UTF-8?B?6K6h566X6L+H56iL?=";
        assert_eq!(decode_mime_header_value(input), "用户数据计算过程");
    }

    #[test]
    fn merges_adjacent_encoded_words_across_linear_whitespace() {
        let input = "=?UTF-8?B?55So5oi35pWw5o2u?= \r\n =?UTF-8?B?6K6h566X6L+H56iL?=";
        assert_eq!(decode_mime_header_value(input), "用户数据计算过程");
    }

    #[test]
    fn keeps_whitespace_between_word_and_plain_text() {
        let input = "=?UTF-8?B?5Lya6K6u?= draft";
        assert_eq!(decode_mime_header_value(input), "会议 draft");
    }

    #[test]
    fn decodes_encoded_word_embedded_in_plain_text() {
        let input = "Re: =?UTF-8?B?55So5oi35pWw5o2u6K6h566X6L+H56iL?=";
        assert_eq!(decode_mime_header_value(input), "Re: 用户数据计算过程");
    }

    #[test]
    fn decodes_rfc2231_utf8_filename() {
        let filename =
            "UTF-8''%E7%94%A8%E6%88%B7%E6%95%B0%E6%8D%AE%E8%AE%A1%E7%AE%97%E8%BF%87%E7%A8%8B26%E6%97%A57%E6%9C%88%E6%B1%87%E6%80%BB%20%281%29.xlsx";
        let (charset, data) = split_rfc2231_extended(filename).unwrap();
        assert_eq!(charset, "UTF-8");
        assert_eq!(
            percent_decode_charset(&data, &charset),
            "用户数据计算过程26日7月汇总 (1).xlsx"
        );
    }

    #[test]
    fn decodes_encoded_word_filename() {
        assert_eq!(
            decode_attachment_filename("=?GBK?B?08O7p8r9vt28xsvjuf2zzDI2yNU31MK749fcICgxKQ==?="),
            EXPECTED_SUBJECT
        );
    }

    #[test]
    fn decodes_percent_encoded_plain_filename() {
        assert_eq!(
            decode_attachment_filename("%E7%94%A8%E6%88%B7%E6%95%B0%E6%8D%AE.xlsx"),
            "用户数据.xlsx"
        );
    }

    #[test]
    fn leaves_plain_filename_untouched() {
        assert_eq!(decode_attachment_filename("report.xlsx"), "report.xlsx");
        assert_eq!(decode_attachment_filename("100% done.txt"), "100% done.txt");
        assert_eq!(decode_attachment_filename("用户数据.xlsx"), "用户数据.xlsx");
    }

    #[test]
    fn decodes_rfc2231_continuations() {
        let parts = vec![
            (
                Cow::Borrowed("filename*0*"),
                Cow::Borrowed("UTF-8''%E7%94%A8%E6%88%B7"),
            ),
            (
                Cow::Borrowed("filename*1*"),
                Cow::Borrowed("%E6%95%B0%E6%8D%AE.xlsx"),
            ),
        ];
        assert_eq!(decode_rfc2231_params(&parts).unwrap(), "用户数据.xlsx");
    }

    #[test]
    fn decodes_plain_encoded_word_filename_param() {
        let parts = vec![(
            Cow::Borrowed("filename"),
            Cow::Borrowed("=?GBK?B?08O7p8r9vt28xsvjuf2zzDI2yNU31MK749fcICgxKQ==?="),
        )];
        assert_eq!(decode_rfc2231_params(&parts).unwrap(), EXPECTED_SUBJECT);
    }

    #[test]
    fn stays_idempotent_for_plain_chinese_text() {
        assert_eq!(
            decode_mime_header_value("用户数据计算过程26日7月汇总 (1)"),
            "用户数据计算过程26日7月汇总 (1)"
        );
        assert_eq!(
            decode_address_header_value("张健 <zhang@example.com>"),
            "张健 <zhang@example.com>"
        );
        assert_eq!(decode_mime_header_value("Hello World"), "Hello World");
        assert_eq!(
            decode_address_header_value("Ada <ada@example.com>"),
            "Ada <ada@example.com>"
        );
    }

    #[test]
    fn malformed_encoded_words_do_not_panic_and_pass_through() {
        let malformed = "=?UTF-8?B?!!invalid!!?=";
        assert_eq!(decode_mime_header_value(malformed), malformed);
        let truncated = "=?UTF-8?B?5byg5Y2a";
        assert_eq!(decode_mime_header_value(truncated), truncated);
        let bad_charset = "=?not-a-charset?B?SGVsbG8=?=";
        assert_eq!(decode_mime_header_value(bad_charset), "Hello");
        assert_eq!(
            decode_mime_header_value("=?UTF-8?Z?5byg?="),
            "=?UTF-8?Z?5byg?="
        );
    }

    #[test]
    fn decodes_bytes_with_declared_charsets() {
        // "用户数据" GBK bytes.
        let gbk = [0xD3, 0xC3, 0xBB, 0xA7, 0xCA, 0xFD, 0xBE, 0xDD];
        assert_eq!(decode_bytes_with_charset(&gbk, "GBK"), "用户数据");
        assert_eq!(decode_bytes_with_charset(&gbk, "gb2312"), "用户数据");
        assert_eq!(decode_bytes_with_charset(&gbk, "GB18030"), "用户数据");
        assert_eq!(decode_bytes_with_charset(&gbk, "unknown"), "用户数据");
        assert_eq!(decode_bytes_with_charset(&gbk, ""), "用户数据");
        // UTF-8 wins even when a legacy charset is declared.
        assert_eq!(
            decode_bytes_with_charset("用户数据".as_bytes(), "gbk"),
            "用户数据"
        );
        // Big5 "你好".
        let big5 = [0xA7, 0x41, 0xA6, 0x6E];
        assert_eq!(decode_bytes_with_charset(&big5, "big5"), "你好");
        // ISO-8859-1 / windows-1252.
        let latin1 = [0x48, 0x6F, 0x6C, 0x61, 0x20, 0x4D, 0x75, 0x6E, 0x64, 0x6F];
        assert_eq!(
            decode_bytes_with_charset(&latin1, "iso-8859-1"),
            "Hola Mundo"
        );
        assert_eq!(
            decode_bytes_with_charset(&latin1, "windows-1252"),
            "Hola Mundo"
        );
        // UTF-8 BOM is stripped.
        assert_eq!(
            decode_bytes_with_charset(&[0xEF, 0xBB, 0xBF, b'A'], "utf-8"),
            "A"
        );
    }

    #[test]
    fn decodes_body_text_with_transfer_encoding_and_charset() {
        // GBK quoted-printable: 用户数据
        let qp = b"=D3=C3=BB=A7=CA=FD=BE=DD";
        assert_eq!(
            decode_body_text(qp, Some("quoted-printable"), Some("GBK")),
            "用户数据"
        );
        // UTF-8 base64
        let b64 = "5byA5Y+R6ICF5pWw5o2u6K6h566X5LiK6Z2i";
        assert_eq!(
            decode_body_text(b64.as_bytes(), Some("base64"), Some("utf-8")),
            "开发者数据计算上面"
        );
        // 8bit with quoted-printable soft breaks preserved semantics.
        let soft = b"Hello=\r\n World";
        assert_eq!(
            decode_body_text(soft, Some("quoted-printable"), Some("utf-8")),
            "Hello World"
        );
    }

    #[test]
    fn extracts_and_folds_raw_header_fields() {
        let raw = b"Subject: Hello\r\n World\r\nFrom: =?utf-8?B?5byg5YGl?= <zhang@example.com>\r\n\r\nbody";
        let fields = extract_header_fields(raw);
        assert_eq!(fields.len(), 2);
        let subject = fields
            .iter()
            .find(|(name, _)| name == "subject")
            .map(|(_, value)| decode_header_value_bytes(value))
            .unwrap();
        assert_eq!(subject, "Hello World");
        let from = fields
            .iter()
            .find(|(name, _)| name == "from")
            .map(|(_, value)| decode_header_value_bytes(value))
            .unwrap();
        assert_eq!(from, "张健 <zhang@example.com>");
    }

    #[test]
    fn extracts_charset_from_content_type_bytes() {
        assert_eq!(
            charset_from_content_type(b"text/plain; charset=GB2312"),
            Some("GB2312".to_string())
        );
        assert_eq!(
            charset_from_content_type(b"text/html; charset=\"utf-8\""),
            Some("utf-8".to_string())
        );
        assert_eq!(charset_from_content_type(b"text/plain"), None);
    }

    #[test]
    fn splits_header_and_body_on_bytes() {
        let (header, body) = split_header_body(b"Subject: Hi\r\n\r\n=D3=C3\r\n");
        assert_eq!(header, b"Subject: Hi");
        assert_eq!(body, b"=D3=C3\r\n");
        let (header, body) = split_header_body(b"Subject: Hi\n\nBody");
        assert_eq!(header, b"Subject: Hi");
        assert_eq!(body, b"Body");
    }

    #[test]
    fn detects_content_type_in_raw_bytes() {
        assert!(contains_ascii_case_insensitive(
            b"Content-Type: TEXT/HTML; charset=GBK",
            b"content-type: text/html"
        ));
        assert!(!contains_ascii_case_insensitive(
            b"Subject: Hi",
            b"content-type"
        ));
    }
}
