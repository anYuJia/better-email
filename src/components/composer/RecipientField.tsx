import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import { useWheelContainment } from '../../hooks/useWheelContainment';
import type { ContactSearchEntry } from './contactSuggestions';
import { matchingContacts } from './contactSuggestions';
import {
  parseRecipientInput,
  parseRecipientToken,
  recipientErrorMessage,
  recipientInputParts,
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
const compositionEnterGuardMs = 80;

function initialParse(value: string) {
  const parsed = parseRecipientInput(value);
  const query = parsed.invalid.map((token) => token.raw).join(', ');
  const chipLabels = Object.fromEntries(
    parsed.valid
      .map((token) => [token.normalized, token.displayName])
      .filter(([, displayName]) => Boolean(displayName)),
  );
  return {
    chips: parsed.valid.map((token) => token.email),
    query,
    chipLabels,
    validationMessage: recipientErrorMessage(parsed.invalid, parsed.duplicates.length),
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
  const suggestionMenuRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const suggestionChosenRef = useRef(false);
  const blockedEmailSet = useMemo(
    () => new Set(blockedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
    [blockedEmails],
  );

  chipsRef.current = chips;
  chipLabelsRef.current = chipLabels;
  queryRef.current = query;

  const matches = useMemo(() => {
    if (!query.trim() || /[,，;；\n\t]/.test(query)) return [];
    const selectedEmails = new Set(chips.map((email) => email.toLowerCase()));
    return matchingContacts(contactSearchEntries, query, suggestionLimit * 2)
      .filter((contact) => {
        const email = contact.email.trim().toLowerCase();
        return email && !selectedEmails.has(email) && !blockedEmailSet.has(email);
      })
      .slice(0, suggestionLimit);
  }, [blockedEmailSet, chips, contactSearchEntries, query]);
  const menuOpen = focused && Boolean(query.trim()) && matches.length > 0 && !suggestionsDismissed;
  useWheelContainment(suggestionMenuRef, menuOpen);
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
    suggestionChosenRef.current = false;
  }, [value]);

  function emit(nextChips: string[], nextLabels = chipLabelsRef.current, pending = queryRef.current) {
    const next = [deriveValue(nextChips, nextLabels), pending.trim()].filter(Boolean).join(', ');
    if (next === lastValueRef.current) return;
    lastValueRef.current = next;
    onChange(next);
  }

  function commitTokens(tokens: ParsedRecipientToken[], tail?: string) {
    const validTokens = tokens.filter((token) => token.valid);
    const invalid = tokens.filter((token) => !token.valid);
    const pendingParts = invalid.map((token) => token.raw);
    if (tail !== undefined) pendingParts.push(pendingParts.length ? tail.trimStart() : tail);
    const pending = pendingParts.join(', ');
    const { next, duplicates, addedTokens } = appendUnique(chipsRef.current, validTokens, blockedEmailSet);
    const nextLabels = { ...chipLabelsRef.current };
    for (const token of addedTokens) {
      if (token.displayName) nextLabels[token.normalized] = token.displayName;
    }
    chipsRef.current = next;
    chipLabelsRef.current = nextLabels;
    queryRef.current = pending;
    setChips(next);
    setChipLabels(nextLabels);
    setQuery(pending);
    setValidationMessage(recipientErrorMessage(invalid, duplicates.length));
    setSuggestionsDismissed(invalid.length > 0);
    emit(next, nextLabels, pending);
    setHighlight(0);
    suggestionChosenRef.current = false;
  }

  function commitEmail(raw: string) {
    const { tokens } = parseRecipientInput(raw);
    if (tokens.length > 1) {
      commitTokens(tokens);
      return;
    }
    const token = parseRecipientToken(raw.trim());
    if (!token.valid) {
      setValidationMessage('请选择匹配联系人，或输入完整邮箱地址');
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

  function setQueryValue(nextQuery: string) {
    queryRef.current = nextQuery;
    setQuery(nextQuery);
    setHighlight(0);
    suggestionChosenRef.current = false;
    setSuggestionsDismissed(false);
    setValidationMessage('');
    emit(chipsRef.current, chipLabelsRef.current, nextQuery);
  }

  function commitCurrentRecipient() {
    const raw = queryRef.current.trim();
    // An explicitly typed complete address wins over a fuzzy default match.
    // Arrow/pointer selection is the user's explicit choice of a suggestion.
    if (menuOpen && activeMatch && (suggestionChosenRef.current || !parseRecipientToken(raw).valid)) {
      commitEmail(activeMatch.email);
    } else if (raw) {
      commitEmail(raw);
    }
  }

  function updateInput(raw: string) {
    const parts = recipientInputParts(raw);
    if (parts.length === 1) {
      setQueryValue(raw);
      return;
    }
    const completed = parts.slice(0, -1).filter((part) => part.trim()).map(parseRecipientToken);
    if (completed.some((token) => token.valid)) {
      commitTokens(completed, parts[parts.length - 1]);
    } else {
      setQueryValue(raw);
      setValidationMessage(recipientErrorMessage(completed));
      setSuggestionsDismissed(true);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) {
      setQueryValue(event.target.value);
    } else {
      updateInput(event.target.value);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    // Single-line inputs strip newlines before onChange. Parse the clipboard
    // with the same delimiters as typed addresses before the browser does so.
    const pasted = event.clipboardData.getData('text/plain');
    if (!/[\r\n\t]/.test(pasted)) return;
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    updateInput(input.value.slice(0, start) + pasted + input.value.slice(end));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const nativeEvent = event.nativeEvent;
    if (composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
    if (event.key === 'Enter' && performance.now() - compositionEndedAtRef.current < compositionEnterGuardMs) return;

    if (event.key === 'Tab') {
      // Commit only a visible forward suggestion; Shift+Tab goes back without
      // silently choosing a contact. Leave focus traversal to the browser.
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const raw = queryRef.current.trim();
        if (menuOpen || (raw && parseRecipientToken(raw).valid)) commitCurrentRecipient();
      }
      setSuggestionsDismissed(true);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (['a', 'c', 'x', 'v', 'z', 'y'].includes(key)) event.stopPropagation();
    }

    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        suggestionChosenRef.current = true;
        setHighlight((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        suggestionChosenRef.current = true;
        setHighlight((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commitCurrentRecipient();
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
    if (!composingRef.current) {
      const parsed = parseRecipientInput(queryRef.current);
      if (parsed.tokens.length) commitTokens(parsed.tokens);
    }
    setFocused(false);
  }

  function chipDisplayName(email: string) {
    const name = chipLabels[email.toLowerCase()];
    if (name?.startsWith('"') && name.endsWith('"')) return name.slice(1, -1).replace(/\\(.)/g, '$1');
    return name || contactForEmail(contactSearchEntries, email)?.name || email;
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
                <X size={16} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            role="combobox"
            aria-label={label}
            aria-invalid={validationMessage && parseRecipientInput(query).invalid.length > 0 ? true : undefined}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={menuOpen ? suggestionListId : undefined}
            aria-expanded={menuOpen}
            aria-activedescendant={activeSuggestionId}
            aria-describedby={validationMessage ? errorId : undefined}
            value={query}
            placeholder={chips.length === 0 ? placeholder : ''}
            onChange={handleInputChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              compositionEndedAtRef.current = performance.now();
              updateInput(event.currentTarget.value);
            }}
            onFocus={() => {
              onFocus?.();
              setFocused(true);
              setHighlight(0);
              suggestionChosenRef.current = false;
              setSuggestionsDismissed(false);
            }}
            onBlur={handleBlur}
          />
          {validationMessage && (
            <span className="composer-recipient-error" id={errorId} role="status">
              {validationMessage}
            </span>
          )}
        </div>
      </label>

      {actions ? <div className="composer-recipient-actions">{actions}</div> : null}

      {menuOpen && (
        <div
          ref={suggestionMenuRef}
          className="recipient-suggestions"
          id={suggestionListId}
          role="listbox"
          aria-label={`${label}匹配联系人`}
        >
          <span aria-hidden="true">匹配联系人</span>
          {matches.map((contact, index) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`${suggestionListId}-option-${contact.id}`}
              key={contact.id}
              className={index === highlight ? 'is-active' : ''}
              aria-selected={index === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                suggestionChosenRef.current = true;
                setHighlight(index);
              }}
              onClick={() => commitEmail(contact.email)}
            >
              <strong>{contact.name || contact.email}</strong>
              {contact.name && <small>{contact.email}</small>}
            </button>
          ))}
        </div>
      )}

    </div>
  );
}
