export type Contact = {
  id: number;
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
  message_count: number;
  last_seen_at: string;
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

export type ContactImportPreviewEntry = {
  email: string;
  name: string;
  aliases: string[];
  vip: boolean;
  status: 'new' | 'merge' | 'duplicate' | 'invalid';
  existing_contact_id: number | null;
  existing_name: string;
  reason: string;
};

export type ContactImportPreview = {
  file_name: string;
  path: string;
  format: string;
  total_count: number;
  new_count: number;
  merge_count: number;
  duplicate_count: number;
  invalid_count: number;
  entries: ContactImportPreviewEntry[];
};

export type ContactImportSelection = {
  email: string;
  action: 'create' | 'merge' | 'skip';
};

export type ContactImportEntryInput = {
  email: string;
  name: string;
  aliases: string[];
  vip: boolean;
  action: 'create' | 'merge' | 'skip';
};

export type ContactImportEntryEdit = {
  email: string;
  name: string;
  aliases: string[];
  vip: boolean;
};

export type ContactImportCommitSummary = {
  batch_id: number;
  created: number;
  merged: number;
  skipped: number;
};

export type ContactImportBatch = {
  id: number;
  file_name: string;
  total_count: number;
  created_count: number;
  merged_count: number;
  skipped_count: number;
  scope: string;
  created_at: string;
};

export type ContactImportUndoReport = {
  removed: number;
  remaining_created: number;
  note: string;
};

