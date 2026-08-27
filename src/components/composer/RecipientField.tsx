import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import type { ContactSearchEntry } from './contactSuggestions';
import { matchingContacts, recommendedContacts } from './contactSuggestions';
import {
  parseRecipientInput,
  parseRecipientToken,
  recipientErrorMessage,
  type ParsedRecipientToken,
} from './recipientAddresses';

type RecipientFieldProps = {
  label: string;
  placeholder: string;
  value: string;
  contactSearchEntries: ContactSearchEntry[];
  blockedEmails?: string[];
  onChange: (value: string) => void;
  onFocus?: () => void;
  actions?: React.ReactNode;
};

const suggestionLimit = 4;

function initialParse(value: string) {
  const parsed = parseRecipientInput(value);
  const lastToken = parsed.tokens[parsed.tokens.length - 1];
  const hasTrailingSeparator = /[,，;；\n\t]\s*$/.test(value);
  const query = lastToken && !lastToken.valid && !hasTrailingSeparator ? lastToken.raw : '';
  const chipLabels = Object.fromEntries(
    parsed.valid
      .map((token) => {
        const displayName = token.raw.match(/^(.+?)\s*<[^<>]+>$/)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
        return [token.normalized, displayName];
      })
      .filter(([, displayName]) => Boolean(displayName)),
  );
  return {
    chips: parsed.valid.map((token) => token.email),
    query,
    chipLabels,
    validationMessage: recipientErrorMessage(parsed.invalid.length, parsed.duplicates.length),
  };
}

function deriveValue(chips: string[], chipLabels: Record<string, string>) {
  return chips
    .map((chip) => {
      const label = chipLabels[chip.toLowerCase()];
      return label ? `${label} <${chip}>` : chip;
    })
    .join(', ');
}

function contactForEmail(entries: ContactSearchEntry[], email: string) {
  const normalizedEmail = email.toLowerCase();
  return entries.find((candidate) => (
    candidate.contact.email.toLowerCase() === normalizedEmail
    || candidate.contact.aliases.some((alias) => alias.toLowerCase() === normalizedEmail)
  ))?.contact;
}

function appendUnique(
  currentChips: string[],
  tokens: ParsedRecipientToken[],
  blockedEmails: Set<string>,
) {
  const next = [...currentChips];
  const seen = new Set(next.map((chip) => chip.toLowerCase()));
  const duplicates: ParsedRecipientToken[] = [];
  const addedTokens: ParsedRecipientToken[] = [];
  for (const token of tokens) {
    if (!token.valid || seen.has(token.normalized) || blockedEmails.has(token.normalized)) {
      if (token.valid) duplicates.push(token);
      continue;
    }
    seen.add(token.normalized);
    next.push(token.email);
    addedTokens.push(token);
  }
  return { next, duplicates, addedTokens };
}

export default function RecipientField({
  label,
  placeholder,
  value,
  contactSearchEntries,
  blockedEmails = [],
  onChange,
  onFocus,
  actions,
}: RecipientFieldProps) {
  const initial = useMemo(() => initialParse(value), [value]);
  const [chips, setChips] = useState<string[]>(initial.chips);
  const [chipLabels, setChipLabels] = useState<Record<string, string>>(initial.chipLabels);
  const [query, setQuery] = useState(initial.query);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [validationMessage, setValidationMessage] = useState(initial.validationMessage);
  const suggestionListId = useId();
  const errorId = useId();
  const lastValueRef = useRef(value);
  const chipsRef = useRef(chips);
  const chipLabelsRef = useRef(chipLabels);
  const queryRef = useRef(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const blockedEmailSet = useMemo(
    () => new Set(blockedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
    [blockedEmails],
  );

  chipsRef.current = chips;
  chipLabelsRef.current = chipLabels;
  queryRef.current = query;

  const matches = useMemo(() => {
    const selectedEmails = new Set(chips.map((email) => email.toLowerCase()));
    const candidates = query.trim()
      ? matchingContacts(contactSearchEntries, query, suggestionLimit * 2)
      : recommendedContacts(contactSearchEntries, suggestionLimit * 2);
    return candidates
      .filter((contact) => {
        const email = contact.email.trim().toLowerCase();
        return email && !selectedEmails.has(email) && !blockedEmailSet.has(email);
      })
      .slice(0, suggestionLimit);
  }, [blockedEmailSet, chips, contactSearchEntries, query]);
  const suggestionHeading = query.trim() ? '匹配联系人' : '最近与常用';
  const menuOpen = focused && matches.length > 0 && !suggestionsDismissed;
  const activeMatch = matches[highlight] ?? matches[0];
  const activeSuggestionId = menuOpen && activeMatch
    ? `${suggestionListId}-option-${activeMatch.id}`
    : undefined;

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const next = initialParse(value);
    chipsRef.current = next.chips;
    chipLabelsRef.current = next.chipLabels;
    queryRef.current = next.query;
    setChips(next.chips);
    setChipLabels(next.chipLabels);
    setQuery(next.query);
    setValidationMessage(next.validationMessage);
    setHighlight(0);
  }, [value]);

  function emit(nextChips: string[], nextLabels = chipLabelsRef.current) {
    const next = deriveValue(nextChips, nextLabels);
    lastValueRef.current = next;
    onChange(next);
  }

  function commitTokens(tokens: ParsedRecipientToken[]) {
    const validTokens = tokens.filter((token) => token.valid);
    const invalidCount = tokens.length - validTokens.length;
    const { next, duplicates, addedTokens } = appendUnique(chipsRef.current, validTokens, blockedEmailSet);
    const nextLabels = { ...chipLabelsRef.current };
    for (const token of addedTokens) {
      const displayName = token.raw.match(/^(.+?)\s*<[^<>]+>$/)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') ?? '';
      if (displayName) nextLabels[token.normalized] = displayName;
    }
    chipsRef.current = next;
    chipLabelsRef.current = nextLabels;
    queryRef.current = '';
    setChips(next);
    setChipLabels(nextLabels);
    setQuery('');
    setValidationMessage(recipientErrorMessage(invalidCount, duplicates.length));
    emit(next, nextLabels);
    setHighlight(0);
  }

  function commitEmail(raw: string) {
    const token = parseRecipientToken(raw);
    if (!token.valid) {
      setValidationMessage('地址格式不正确，已跳过');
      setQuery('');
      queryRef.current = '';
      return;
    }
    commitTokens([token]);
  }

  function removeChip(index: number) {
    const currentChips = chipsRef.current;
    if (index < 0 || index >= currentChips.length) return;
    const next = currentChips.filter((_, chipIndex) => chipIndex !== index);
    const nextLabels = { ...chipLabelsRef.current };
    delete nextLabels[currentChips[index].toLowerCase()];
    chipsRef.current = next;
    chipLabelsRef.current = nextLabels;
    setChips(next);
    setChipLabels(nextLabels);
    emit(next, nextLabels);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSuggestionsDismissed(false);
    const raw = event.target.value;
    const parts = raw.split(/[,，;；\n\t]/);
    if (parts.length > 1) {
      const committed = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
      commitTokens(committed.map(parseRecipientToken));
      const nextQuery = parts[parts.length - 1] ?? '';
      queryRef.current = nextQuery;
      setQuery(nextQuery);
    } else {
      queryRef.current = raw;
      setQuery(raw);
      if (!raw.trim()) setValidationMessage('');
    }
    setHighlight(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commitEmail(activeMatch.email);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setHighlight(0);
        setSuggestionsDismissed(true);
        return;
      }
    }
    if (event.key === 'Enter') {
      const trimmed = queryRef.current.trim();
      if (trimmed) {
        event.preventDefault();
        commitEmail(trimmed);
      }
      return;
    }
    if (event.key === 'Backspace' && queryRef.current === '' && chipsRef.current.length > 0) {
      event.preventDefault();
      removeChip(chipsRef.current.length - 1);
    }
  }

  function handleBlur() {
    const trimmed = queryRef.current.trim();
    if (trimmed) commitEmail(trimmed);
    setFocused(false);
  }

  function chipDisplayName(email: string) {
    return chipLabels[email.toLowerCase()] || contactForEmail(contactSearchEntries, email)?.name || email;
  }

  return (
    <div className={`composer-recipient-field${menuOpen ? ' has-suggestions' : ''}`}>
      <label className="composer-field-row">
        <span>{label}</span>
        <div className="composer-recipient-editor">
          {chips.map((chip, index) => (
            <span className="composer-recipient-chip" key={`${chip}-${index}`}>
              <span className="composer-recipient-chip-copy" title={chip}>{chipDisplayName(chip)}</span>
              <button
                type="button"
                aria-label={`移除 ${chip}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeChip(index);
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            autoComplete="off"
            role="combobox"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={menuOpen ? suggestionListId : undefined}
            aria-expanded={menuOpen}
            aria-activedescendant={activeSuggestionId}
            aria-describedby={validationMessage ? errorId : undefined}
            value={query}
            placeholder={chips.length === 0 ? placeholder : ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              onFocus?.();
              setFocused(true);
              setHighlight(0);
              setSuggestionsDismissed(false);
            }}
            onBlur={handleBlur}
          />
        </div>
      </label>

      {actions ? <div className="composer-recipient-actions">{actions}</div> : null}

      {menuOpen && (
        <div className="recipient-suggestions" id={suggestionListId} role="listbox" aria-label={`${label}${suggestionHeading}`}>
          <span aria-hidden="true">{suggestionHeading}</span>
          {matches.map((contact, index) => (
            <button
              type="button"
              role="option"
              id={`${suggestionListId}-option-${contact.id}`}
              key={contact.id}
              className={index === highlight ? 'is-active' : ''}
              aria-selected={index === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => commitEmail(contact.email)}
            >
              <strong>{contact.name || contact.email}</strong>
              {contact.name && <small>{contact.email}</small>}
            </button>
          ))}
        </div>
      )}
      {validationMessage && (
        <p className="composer-recipient-error" id={errorId} role="status">
          {validationMessage}
        </p>
      )}
    </div>
  );
}
