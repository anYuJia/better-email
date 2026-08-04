import type {
  Account,
  DraftInput,
  MailIdentity,
} from './types';

export function resolveDraftAccountId(
  input: DraftInput,
  account: Account | null,
  accounts: Account[],
): number {
  return input.account_id || account?.id || accounts[0]?.id || 0;
}

export function identitiesForDraftAccount(
  input: DraftInput,
  identities: MailIdentity[],
): MailIdentity[] {
  const accountId = input.account_id;
  return identities.filter((identity) => identity.account_id === accountId);
}

export function identityForDraft(
  input: DraftInput,
  identities: MailIdentity[],
): MailIdentity | null {
  const draftIdentities = identitiesForDraftAccount(input, identities);
  return (
    draftIdentities.find((identity) => identity.id === input.identity_id) ??
    draftIdentities.find((identity) => identity.is_default) ??
    draftIdentities[0] ??
    null
  );
}

export function draftInputForCurrentAccount(
  input: DraftInput,
  account: Account | null,
  accounts: Account[],
  identities: MailIdentity[],
): DraftInput {
  const resolvedAccountId = resolveDraftAccountId(input, account, accounts);
  const resolvedIdentity = identityForDraft({ ...input, account_id: resolvedAccountId }, identities);
  return {
    ...input,
    account_id: resolvedAccountId,
    identity_id: input.identity_id || resolvedIdentity?.id || 0,
  };
}

export function threadingForDraft(input: DraftInput) {
  const inReplyTo = input.in_reply_to?.trim() ?? '';
  const references = input.references?.trim() ?? '';
  return inReplyTo || references
    ? { in_reply_to: inReplyTo, references }
    : null;
}

export function accountForDraft(
  input: DraftInput,
  account: Account | null,
  accounts: Account[],
): Account | null {
  const accountId = resolveDraftAccountId(input, account, accounts);
  return accounts.find((entry) => entry.id === accountId) ?? account ?? accounts[0] ?? null;
}
