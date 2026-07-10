use crate::models::{Contact, ContactCreateInput};

#[derive(Debug, Clone)]
pub struct ParsedVcards {
    pub contacts: Vec<ContactCreateInput>,
    pub total_cards: i64,
    pub skipped: i64,
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
            lines.last_mut().expect("line exists").push_str(&line[1..]);
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
    fn rendered_contacts_round_trip_names_aliases_and_vip() {
        let payload = render_contacts(&[Contact {
            id: 1,
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
}
