use std::collections::VecDeque;
use std::sync::Mutex;

const CACHE_BYTES: usize = 8 * 1024 * 1024;
const ENTRY_BYTES: usize = 2 * 1024 * 1024;
const CACHE_ENTRIES: usize = 8;

struct Entry {
    id: i64,
    body: String,
    html: String,
}
impl Entry {
    fn bytes(&self) -> usize {
        self.body.len() + self.html.len()
    }
}

#[derive(Default)]
pub(super) struct TrustedHtmlCache {
    entries: VecDeque<Entry>,
    bytes: usize,
}
impl TrustedHtmlCache {
    fn get(&mut self, id: i64, body: &str) -> Option<String> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.id == id && entry.body == body)?;
        let entry = self.entries.remove(index)?;
        let html = entry.html.clone();
        self.entries.push_back(entry);
        Some(html)
    }
    fn put(&mut self, id: i64, body: &str, html: &str) {
        if let Some(index) = self.entries.iter().position(|entry| entry.id == id) {
            if let Some(previous) = self.entries.remove(index) {
                self.bytes -= previous.bytes();
            }
        }
        let bytes = body.len().saturating_add(html.len());
        if bytes > ENTRY_BYTES {
            return;
        }
        while self.bytes + bytes > CACHE_BYTES || self.entries.len() >= CACHE_ENTRIES {
            let Some(entry) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= entry.bytes();
        }
        self.entries.push_back(Entry {
            id,
            body: body.into(),
            html: html.into(),
        });
        self.bytes += bytes;
    }
}

pub(super) fn sanitize(cache: &Mutex<TrustedHtmlCache>, id: i64, body: &str) -> String {
    if let Some(html) = cache
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(id, body)
    {
        return html;
    }
    // No SQLite or cache mutex is held while parsing. Callers must recheck
    // the current trust policy before using this trusted-policy-only cache.
    let html = crate::protocol::sanitize_html_with_remote_images(body);
    cache
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .put(id, body, &html);
    html
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_changes_never_reuse_old_html_and_cache_is_bounded() {
        let mut cache = TrustedHtmlCache::default();
        cache.put(1, "original", "safe original");
        assert_eq!(cache.get(1, "original").as_deref(), Some("safe original"));
        assert!(cache.get(1, "updated").is_none());
        for id in 2..20 {
            cache.put(id, "body", "html");
        }
        assert!(cache.entries.len() <= CACHE_ENTRIES);
        assert!(cache.get(1, "original").is_none());
        cache.put(20, &"x".repeat(ENTRY_BYTES), "output");
        assert!(!cache.entries.iter().any(|entry| entry.id == 20));
        assert!(cache.bytes <= CACHE_BYTES);
    }
}
