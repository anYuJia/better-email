//! Tauri command facade.
//!
//! Commands are implemented in domain submodules under `commands/` and
//! re-exported here so external paths such as `commands::list_accounts`
//! and `commands::sync_imap_headers` keep resolving unchanged.

mod accounts;
mod attachments;
mod background;
mod benchmark;
mod common;
mod contacts_rules;
mod messages;
mod oauth;
mod outbox;
mod settings_data;
mod sync;

pub use accounts::*;
pub use attachments::*;
pub use background::*;
pub use benchmark::*;
pub use contacts_rules::*;
pub use messages::*;
pub use oauth::*;
pub use outbox::*;
pub use settings_data::*;
pub use sync::*;
