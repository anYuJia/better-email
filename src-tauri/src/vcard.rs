use crate::models::{Contact, ContactCreateInput};
use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
use encoding_rs::GB18030;

#[derive(Debug, Clone)]
pub struct ParsedVcards {
    pub contacts: Vec<ContactCreateInput>,
    pub total_cards: i64,
    pub skipped: i64,
}

#[derive(Debug, Clone)]
pub struct ParsedContactImport {
    pub contacts: Vec<ContactCreateInput>,
    pub total: i64,
    pub skipped: i64,
    pub format: String,
}

pub fn parse_contact_import(raw: &str, file_name: &str) -> ParsedContactImport {
    let is_csv = file_name.to_ascii_lowercase().ends_with(".csv") || !raw.contains("BEGIN:VCARD");
    if is_csv {
        let parsed = parse_contacts_csv(raw);
        ParsedContactImport {
            contacts: parsed.contacts,
            total: parsed.total_cards,
            skipped: parsed.skipped,
            format: "csv".to_string(),
        }
    } else {
        let parsed = parse_contacts(raw);
        ParsedContactImport {
            contacts: parsed.contacts,
            total: parsed.total_cards,
            skipped: parsed.skipped,
            format: "vcard".to_string(),
        }
    }
}

pub fn parse_contact_import_bytes(
    payload: &[u8],
    file_name: &str,
) -> Result<ParsedContactImport, String> {
    let lower_name = file_name.to_ascii_lowercase();
    if lower_name.ends_with(".xlsx") || lower_name.ends_with(".xlsm") {
        let parsed = parse_contacts_xlsx(payload)?;
        return Ok(ParsedContactImport {
            contacts: parsed.contacts,
            total: parsed.total_cards,
            skipped: parsed.skipped,
            format: "xlsx".to_string(),
        });
    }
    let raw = decode_contact_text(payload, file_name)?;
    Ok(parse_contact_import(&raw, file_name))
}

fn contact_text_format(file_name: &str) -> Option<&'static str> {
    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())?;
    match extension.as_str() {
        "csv" => Some("CSV"),
        "vcf" | "vcard" => Some("vCard"),
        _ => None,
    }
}

fn encoding_error(format: &str) -> String {
    format!("{format} 文件编码无法识别。请将文件另存为 UTF-8（推荐）或 GB18030 编码后再导入。")
}

fn strip_utf8_bom(value: &str) -> String {
    value.strip_prefix('\u{feff}').unwrap_or(value).to_string()
}

fn decode_utf16_with_bom(payload: &[u8]) -> Result<Option<String>, String> {
    if payload.len() < 2 {
        return Ok(None);
    }
    let (little_endian, bytes) = match payload[..2] {
        [0xff, 0xfe] => (true, &payload[2..]),
        [0xfe, 0xff] => (false, &payload[2..]),
        _ => return Ok(None),
    };
    if bytes.len() % 2 != 0 {
        return Err("文件编码无法识别。请将 CSV 或 vCard 另存为 UTF-8 编码后再导入。".to_string());
    }
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| {
            if little_endian {
                u16::from_le_bytes(*chunk)
            } else {
                u16::from_be_bytes(*chunk)
            }
        })
        .collect();
    String::from_utf16(&units)
        .map(Some)
        .map_err(|_| "文件编码无法识别。请将 CSV 或 vCard 另存为 UTF-8 编码后再导入。".to_string())
}

fn decode_contact_text(payload: &[u8], file_name: &str) -> Result<String, String> {
    let Some(format) = contact_text_format(file_name) else {
        return Err(
            "不支持的联系人文件格式。请选择 vCard（.vcf/.vcard）、CSV（.csv）或 Excel（.xlsx/.xlsm）文件。"
                .to_string(),
        );
    };
    if let Ok(value) = std::str::from_utf8(payload) {
        return Ok(strip_utf8_bom(value));
    }
    if let Some(value) = decode_utf16_with_bom(payload)? {
        return Ok(strip_utf8_bom(&value));
    }
    let (decoded, _, had_errors) = GB18030.decode(payload);
    if !had_errors {
        return Ok(strip_utf8_bom(&decoded));
    }
    Err(encoding_error(format))
}

pub fn parse_contacts_xlsx(payload: &[u8]) -> Result<ParsedVcards, String> {
    let mut workbook: Xlsx<std::io::Cursor<&[u8]>> =
        open_workbook_from_rs(std::io::Cursor::new(payload))
            .map_err(|error| format!("无法解析 xlsx 文件：{error}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let sheet_name = sheet_names
        .first()
        .map(String::as_str)
        .ok_or_else(|| "xlsx 文件中没有工作表。".to_string())?;
    let range = workbook
        .worksheet_range(sheet_name)
        .map_err(|error| format!("读取 xlsx 工作表失败：{error}"))?;
    let rows: Vec<Vec<String>> = range
        .rows()
        .map(|row| {
            row.iter()
                .map(|cell| match cell {
                    Data::String(value) => value.clone(),
                    other => other.to_string(),
                })
                .collect()
        })
        .collect();
    Ok(parse_contact_rows(rows))
}

pub fn parse_contacts_csv(raw: &str) -> ParsedVcards {
    parse_contact_rows(parse_csv_rows(raw))
}

#[derive(Debug, Clone)]
struct ContactColumnMap {
    name: Option<usize>,
    emails: Vec<usize>,
}

fn normalized_header(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace() && !matches!(character, '_' | '-' | ':'))
        .collect()
}

fn is_email_header(value: &str) -> bool {
    let normalized = normalized_header(value);
    normalized.contains("email")
        || normalized.contains("邮箱")
        || normalized.contains("电子邮件")
        || normalized.contains("邮件地址")
        || normalized == "mail"
}

fn is_name_header(value: &str) -> bool {
    let normalized = normalized_header(value);
    normalized == "name"
        || normalized == "fullname"
        || normalized == "displayname"
        || normalized == "contactname"
        || normalized.contains("姓名")
        || normalized.contains("联系人")
        || normalized == "名字"
        || normalized == "昵称"
        || normalized == "名称"
}

fn contact_column_map(row: &[String]) -> Option<ContactColumnMap> {
    let emails: Vec<usize> = row
        .iter()
        .enumerate()
        .filter_map(|(index, cell)| is_email_header(cell).then_some(index))
        .collect();
    if emails.is_empty() {
        return None;
    }
    let name = row
        .iter()
        .enumerate()
        .find_map(|(index, cell)| is_name_header(cell).then_some(index));
    Some(ContactColumnMap { name, emails })
}

fn is_numeric_identifier(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.chars().any(|character| character.is_ascii_digit())
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, '+' | '-' | ' '))
}

fn extract_emails(value: &str) -> Vec<String> {
    value
        .split([',', ';', ' '])
        .filter_map(|part| {
            let candidate = part.trim().trim_matches('"').trim().to_ascii_lowercase();
            is_valid_email(&candidate).then_some(candidate)
        })
        .collect()
}

fn parse_contact_rows(rows: Vec<Vec<String>>) -> ParsedVcards {
    let mut contacts: Vec<ContactCreateInput> = Vec::new();
    let mut skipped = 0_i64;
    let mut column_map: Option<ContactColumnMap> = None;
    for row in rows {
        let cells = row;
        if cells.len() == 1 && cells[0].trim().is_empty() {
            skipped += 1;
            continue;
        }
        if column_map.is_none() {
            if let Some(map) = contact_column_map(&cells) {
                column_map = Some(map);
                continue;
            }
        }

        let mut name_candidates: Vec<String> = Vec::new();
        let mut email_cells: Vec<String> = Vec::new();
        if let Some(map) = &column_map {
            if let Some(index) = map.name {
                if let Some(value) = cells
                    .get(index)
                    .map(|cell| cell.trim())
                    .filter(|value| !value.is_empty())
                {
                    name_candidates.push(value.to_string());
                }
            }
            for index in &map.emails {
                if let Some(value) = cells.get(*index) {
                    email_cells.push(value.clone());
                }
            }
        } else {
            name_candidates.extend(
                cells
                    .iter()
                    .filter(|cell| !cell.trim().is_empty() && extract_emails(cell).is_empty())
                    .cloned(),
            );
            email_cells.extend(cells.iter().cloned());
        }

        let mut name = name_candidates
            .iter()
            .find(|candidate| !is_numeric_identifier(candidate))
            .cloned()
            .unwrap_or_default();
        let mut parsed_email_cells: Vec<String> = Vec::new();
        for cell in &email_cells {
            let value = cell.trim();
            if value.is_empty() {
                continue;
            }
            parsed_email_cells.extend(extract_emails(value));
        }
        if parsed_email_cells.is_empty() {
            skipped += 1;
            continue;
        }
        parsed_email_cells.sort();
        parsed_email_cells.dedup();
        let primary = parsed_email_cells.remove(0);
        if name.is_empty() {
            name = primary.clone();
        }
        contacts.push(ContactCreateInput {
            name,
            email: primary,
            aliases: parsed_email_cells,
            vip: false,
        });
    }
    ParsedVcards {
        total_cards: contacts.len() as i64 + skipped,
        contacts,
        skipped,
    }
}

fn parse_csv_rows(raw: &str) -> Vec<Vec<String>> {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut in_quotes = false;
    let mut chars = normalized.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '"' if !in_quotes => in_quotes = true,
            '"' if in_quotes => {
                if chars.peek() == Some(&'"') {
                    cell.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            }
            ',' if !in_quotes => {
                current.push(cell.trim().to_string());
                cell.clear();
            }
            '\n' if !in_quotes => {
                current.push(cell.trim().to_string());
                cell.clear();
                if current.iter().any(|value| !value.trim().is_empty()) {
                    rows.push(current);
                }
                current = Vec::new();
            }
            _ => cell.push(character),
        }
    }
    if !cell.is_empty() || !current.is_empty() {
        current.push(cell.trim().to_string());
        if current.iter().any(|value| !value.trim().is_empty()) {
            rows.push(current);
        }
    }
    rows
}

pub fn parse_contacts(raw: &str) -> ParsedVcards {
    let lines = unfold_lines(raw);
    let mut contacts = Vec::new();
    let mut card_lines = Vec::new();
    let mut in_card = false;
    let mut total_cards = 0_i64;
    let mut skipped = 0_i64;

    for line in lines {
        if line.eq_ignore_ascii_case("BEGIN:VCARD") {
            in_card = true;
            card_lines.clear();
            continue;
        }
        if line.eq_ignore_ascii_case("END:VCARD") {
            if in_card {
                total_cards += 1;
                if let Some(contact) = parse_card(&card_lines) {
                    contacts.push(contact);
                } else {
                    skipped += 1;
                }
            }
            in_card = false;
            card_lines.clear();
            continue;
        }
        if in_card {
            card_lines.push(line);
        }
    }

    ParsedVcards {
        contacts,
        total_cards,
        skipped,
    }
}

pub fn render_contacts(contacts: &[Contact]) -> String {
    let mut output = String::new();
    for contact in contacts {
        output.push_str("BEGIN:VCARD\r\nVERSION:4.0\r\n");
        output.push_str("FN:");
        output.push_str(&escape_value(if contact.name.trim().is_empty() {
            &contact.email
        } else {
            &contact.name
        }));
        output.push_str("\r\nEMAIL;PREF=1:");
        output.push_str(&contact.email);
        output.push_str("\r\n");
        for alias in &contact.aliases {
            output.push_str("EMAIL:");
            output.push_str(alias);
            output.push_str("\r\n");
        }
        if contact.vip {
            output.push_str("CATEGORIES:VIP\r\nX-BETTER-EMAIL-VIP:TRUE\r\n");
        }
        output.push_str("END:VCARD\r\n");
    }
    output
}

fn parse_card(lines: &[String]) -> Option<ContactCreateInput> {
    let mut formatted_name = String::new();
    let mut structured_name = String::new();
    let mut emails: Vec<(String, bool)> = Vec::new();
    let mut vip = false;

    for line in lines {
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            continue;
        };
        let property = raw_key
            .split(';')
            .next()
            .unwrap_or_default()
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let parameters = raw_key.to_ascii_uppercase();
        let value = decode_value(raw_value.trim());

        match property.as_str() {
            "FN" => formatted_name = value.trim().to_string(),
            "N" => structured_name = structured_name_to_display(&value),
            "EMAIL" => {
                let email = normalize_email_value(&value);
                if is_valid_email(&email) && !emails.iter().any(|(existing, _)| existing == &email)
                {
                    let preferred = parameters.contains("PREF=1")
                        || parameters.contains("TYPE=PREF")
                        || parameters.contains("TYPE=INTERNET,PREF")
                        || parameters.contains("TYPE=PREF,INTERNET");
                    emails.push((email, preferred));
                }
            }
            "CATEGORIES" => {
                vip = value
                    .split(',')
                    .any(|category| category.trim().eq_ignore_ascii_case("vip"));
            }
            "X-BETTER-EMAIL-VIP" => {
                vip = matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "true" | "yes" | "1"
                );
            }
            _ => {}
        }
    }

    if emails.is_empty() {
        return None;
    }
    let primary_index = emails
        .iter()
        .position(|(_, preferred)| *preferred)
        .unwrap_or(0);
    let primary = emails.remove(primary_index).0;
    let aliases = emails.into_iter().map(|(email, _)| email).collect();
    let name = if !formatted_name.trim().is_empty() {
        formatted_name.trim().to_string()
    } else if !structured_name.trim().is_empty() {
        structured_name.trim().to_string()
    } else {
        primary.clone()
    };

    Some(ContactCreateInput {
        name,
        email: primary,
        aliases,
        vip,
    })
}

fn unfold_lines(raw: &str) -> Vec<String> {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<String> = Vec::new();
    for line in normalized.lines() {
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            if let Some(previous) = lines.last_mut() {
                previous.push_str(&line[1..]);
            }
        } else {
            lines.push(line.to_string());
        }
    }
    lines
}

fn structured_name_to_display(value: &str) -> String {
    let parts = value.split(';').collect::<Vec<_>>();
    let family = parts.first().copied().unwrap_or_default().trim();
    let given = parts.get(1).copied().unwrap_or_default().trim();
    let additional = parts.get(2).copied().unwrap_or_default().trim();
    let prefix = parts.get(3).copied().unwrap_or_default().trim();
    let suffix = parts.get(4).copied().unwrap_or_default().trim();
    [prefix, given, additional, family, suffix]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_email_value(value: &str) -> String {
    value
        .trim()
        .strip_prefix("mailto:")
        .or_else(|| value.trim().strip_prefix("MAILTO:"))
        .unwrap_or(value.trim())
        .trim()
        .to_ascii_lowercase()
}

fn is_valid_email(value: &str) -> bool {
    let mut parts = value.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    !local.is_empty()
        && domain.contains('.')
        && parts.next().is_none()
        && !value.chars().any(char::is_whitespace)
}

fn decode_value(value: &str) -> String {
    let mut output = String::new();
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => output.push('\n'),
            Some('\\') => output.push('\\'),
            Some(',') => output.push(','),
            Some(';') => output.push(';'),
            Some(other) => output.push(other),
            None => output.push('\\'),
        }
    }
    output
}

fn escape_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parses_folded_vcard_with_preferred_email_alias_and_vip() {
        let parsed = parse_contacts(concat!(
            "BEGIN:VCARD\r\n",
            "VERSION:3.0\r\n",
            "N:Lovelace;Ada;;Countess;\r\n",
            "FN:Ada\\, Countess of Lovelace\r\n",
            "EMAIL;TYPE=INTERNET:ada@personal.example.com\r\n",
            "EMAIL;TYPE=PREF,INTERNET:ADA@EXAMPLE.COM\r\n",
            "EMAIL:ada@work.example.com\r\n",
            "CATEGORIES:Engineering,\r\n",
            " VIP\r\n",
            "END:VCARD\r\n",
        ));

        assert_eq!(parsed.total_cards, 1);
        assert_eq!(parsed.skipped, 0);
        assert_eq!(parsed.contacts.len(), 1);
        let contact = &parsed.contacts[0];
        assert_eq!(contact.name, "Ada, Countess of Lovelace");
        assert_eq!(contact.email, "ada@example.com");
        assert_eq!(
            contact.aliases,
            vec![
                "ada@personal.example.com".to_string(),
                "ada@work.example.com".to_string()
            ]
        );
        assert!(contact.vip);
    }

    #[test]
    fn skips_cards_without_valid_email() {
        let parsed = parse_contacts(
            "BEGIN:VCARD\nVERSION:4.0\nFN:No Address\nEND:VCARD\n\
             BEGIN:VCARD\nVERSION:4.0\nFN:Valid\nEMAIL:valid@example.com\nEND:VCARD\n",
        );
        assert_eq!(parsed.total_cards, 2);
        assert_eq!(parsed.skipped, 1);
        assert_eq!(parsed.contacts.len(), 1);
    }

    #[test]
    fn parses_vcard_with_malformed_leading_folded_line() {
        let parsed = parse_contacts(concat!(
            " orphaned continuation\r\n",
            "BEGIN:VCARD\r\n",
            "VERSION:3.0\r\n",
            "FN:Katherine Johnson\r\n",
            "EMAIL:katherine@example.com\r\n",
            "END:VCARD\r\n",
        ));

        assert_eq!(parsed.total_cards, 1);
        assert_eq!(parsed.skipped, 0);
        assert_eq!(parsed.contacts.len(), 1);
        assert_eq!(parsed.contacts[0].email, "katherine@example.com");
    }

    #[test]
    fn rendered_contacts_round_trip_names_aliases_and_vip() {
        let payload = render_contacts(&[Contact {
            id: 1,
            account_id: 1,
            name: "Ada, Lovelace".to_string(),
            email: "ada@example.com".to_string(),
            aliases: vec!["ada@work.example.com".to_string()],
            vip: true,
            message_count: 4,
            last_seen_at: String::new(),
        }]);
        let parsed = parse_contacts(&payload);
        assert_eq!(parsed.contacts.len(), 1);
        assert_eq!(parsed.contacts[0].name, "Ada, Lovelace");
        assert_eq!(parsed.contacts[0].email, "ada@example.com");
        assert_eq!(
            parsed.contacts[0].aliases,
            vec!["ada@work.example.com".to_string()]
        );
        assert!(parsed.contacts[0].vip);
    }

    #[test]
    fn parses_csv_contacts_with_quoted_names_and_aliases() {
        let parsed = parse_contacts_csv(
            "姓名,邮箱\n\"Ada, Lovelace\",ada@example.com;ada@work.example.com\nKatherine,katherine@example.com\nbad-row-no-email\n",
        );
        assert_eq!(parsed.skipped, 1);
        assert_eq!(parsed.contacts.len(), 2);
        let ada = parsed
            .contacts
            .iter()
            .find(|item| item.email == "ada@example.com")
            .unwrap();
        assert_eq!(ada.name, "Ada, Lovelace");
        assert!(ada.aliases.contains(&"ada@work.example.com".to_string()));
        let katherine = parsed
            .contacts
            .iter()
            .find(|item| item.email == "katherine@example.com")
            .unwrap();
        assert_eq!(katherine.name, "Katherine");
    }

    #[test]
    fn maps_csv_name_and_email_columns_instead_of_using_numeric_ids() {
        let parsed = parse_contacts_csv(concat!(
            "编号,手机号,姓名,邮箱地址\n",
            "-9000000000000000001,13800000000,测试联系人,person.one@example.com\n",
            "006973,13800000001,,person.two@example.com\n",
        ));

        assert_eq!(parsed.contacts.len(), 2);
        assert_eq!(parsed.contacts[0].name, "测试联系人");
        assert_eq!(parsed.contacts[0].email, "person.one@example.com");
        assert_eq!(parsed.contacts[1].name, "person.two@example.com");

        let no_header = parse_contacts_csv("12345,张三,zhangsan@example.com\n");
        assert_eq!(no_header.contacts[0].name, "张三");
    }

    #[test]
    fn csv_parser_handles_escaped_quotes_and_detects_header() {
        let parsed = parse_contacts_csv("name,email\n\"\"\"Dr.\"\" Grace\",grace@example.com\n");
        assert_eq!(parsed.contacts.len(), 1);
        assert_eq!(parsed.contacts[0].name, "\"Dr.\" Grace");
    }

    #[test]
    fn detects_csv_vs_vcard_by_extension_and_content() {
        let csv_parsed = parse_contact_import("name,email\nAda,ada@example.com\n", "contacts.csv");
        assert_eq!(csv_parsed.format, "csv");
        let vcard_parsed = parse_contact_import(
            "BEGIN:VCARD\nFN:Ada\nEMAIL:ada@example.com\nEND:VCARD\n",
            "contacts.vcf",
        );
        assert_eq!(vcard_parsed.format, "vcard");
        assert_eq!(vcard_parsed.contacts.len(), 1);
    }

    #[test]
    fn decodes_gb18030_csv_and_utf8_bom() {
        let (gb18030, _, had_errors) = GB18030.encode("姓名,邮箱\n张三,zhang@example.com\n");
        assert!(!had_errors);
        let parsed = parse_contact_import_bytes(&gb18030, "contacts.csv").unwrap();
        assert_eq!(parsed.contacts[0].name, "张三");

        let utf8_bom = b"\xef\xbb\xbfname,email\nAda,ada@example.com\n";
        let parsed = parse_contact_import_bytes(utf8_bom, "contacts.csv").unwrap();
        assert_eq!(parsed.contacts[0].email, "ada@example.com");
    }

    #[test]
    fn reports_actionable_errors_for_unsupported_and_invalid_text_files() {
        let unsupported = parse_contact_import_bytes(b"not a contact", "video.mp4").unwrap_err();
        assert!(unsupported.contains("不支持的联系人文件格式"));

        let invalid = parse_contact_import_bytes(&[0xff, 0xff, 0xff], "contacts.csv").unwrap_err();
        assert!(invalid.contains("CSV 文件编码无法识别"));
    }

    fn build_minimal_xlsx() -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            let files = [
                (
                    "[Content_Types].xml",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>"#,
                ),
                (
                    "_rels/.rels",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#,
                ),
                (
                    "xl/workbook.xml",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#,
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>"#,
                ),
                (
                    "xl/sharedStrings.xml",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
<si><t>姓名</t></si><si><t>邮箱</t></si><si><t>Alice</t></si><si><t>alice@example.com</t></si><si><t>Bob</t></si><si><t>bob@example.com</t></si>
</sst>"#,
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row>
</sheetData>
</worksheet>"#,
                ),
            ];
            for (name, content) in files {
                writer.start_file(name, options).unwrap();
                writer.write_all(content.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn parses_xlsx_contacts_from_first_sheet() {
        let payload = build_minimal_xlsx();
        let parsed = parse_contact_import_bytes(&payload, "contacts.xlsx").unwrap();

        assert_eq!(parsed.format, "xlsx");
        assert_eq!(parsed.total, 2);
        assert_eq!(parsed.skipped, 0);
        assert_eq!(parsed.contacts.len(), 2);
        let alice = parsed
            .contacts
            .iter()
            .find(|item| item.email == "alice@example.com")
            .unwrap();
        assert_eq!(alice.name, "Alice");
        let bob = parsed
            .contacts
            .iter()
            .find(|item| item.email == "bob@example.com")
            .unwrap();
        assert_eq!(bob.name, "Bob");
    }

    #[test]
    fn rejects_invalid_xlsx_payloads() {
        let error = parse_contact_import_bytes(b"not a zip at all", "contacts.xlsx").unwrap_err();
        assert!(error.contains("xlsx"));
    }
}
