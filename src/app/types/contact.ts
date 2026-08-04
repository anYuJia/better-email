export type Contact = {
  id: number;
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
  message_count: number;
  last_seen_at: string;
};


export type ContactMergeSuggestion = {
  target: Contact;
  source: Contact;
  reason: string;
  shared_keys: string[];
};


export type ContactCreateInput = {
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
};


export type ContactImportSummary = {
  path: string;
  total_cards: number;
  created: number;
  updated: number;
  skipped: number;
  size_bytes: number;
};


export type ContactExportSummary = {
  path: string;
  contacts: number;
  size_bytes: number;
};

