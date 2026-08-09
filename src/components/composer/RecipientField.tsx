import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import type { ContactSearchEntry } from './contactSuggestions';
import { matchingContacts } from './contactSuggestions';

type RecipientFieldProps = {
  label: string;
  placeholder: string;
  value: string;
  contactSearchEntries: ContactSearchEntry[];
  onChange: (value: string) => void;
};

const suggestionLimit = 5;
const emailPattern = /^[^\s@;,:]+@[^\s@;,:]+\.[^\s@;,:]+$/;

function parseParts(value: string) {
  return value.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
}

function initialParse(value: string) {
  if (!value.trim()) return { chips: [] as string[], query: '' };
  const parts = parseParts(value);
  const last = parts[parts.length - 1];
  if (emailPattern.test(last)) {
    return { chips: parts, query: '' };
  }
  return { chips: parts.slice(0, -1), query: last };
}

function deriveValue(chips: string[], query: string) {
  const parts = [...chips];
  const trimmed = query.trim();
  if (trimmed) parts.push(trimmed);
  return parts.join(', ');
}

export default function RecipientField({
  label,
  placeholder,
  value,
  contactSearchEntries,
  onChange,
}: RecipientFieldProps) {
  const [chips, setChips] = useState<string[]>(() => initialParse(value).chips);
  const [query, setQuery] = useState<string>(() => initialParse(value).query);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const lastValueRef = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => (query.trim() ? matchingContacts(contactSearchEntries, query, suggestionLimit) : []),
    [contactSearchEntries, query],
  );

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const { chips: nextChips, query: nextQuery } = initialParse(value);
    setChips(nextChips);
    setQuery(nextQuery);
    setHighlight(0);
  }, [value]);

  function emit(nextChips: string[], nextQuery: string) {
    const next = deriveValue(nextChips, nextQuery);
    lastValueRef.current = next;
    onChange(next);
  }

  function commitEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    const nextChips = chips.some((chip) => chip.toLowerCase() === normalized)
      ? chips
      : [...chips, email.trim()];
    setChips(nextChips);
    setQuery('');
    emit(nextChips, '');
    setHighlight(0);
  }

  function removeChip(index: number) {
    const nextChips = chips.filter((_, chipIndex) => chipIndex !== index);
    setChips(nextChips);
    emit(nextChips, query);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const parts = raw.split(/[;,]/);
    if (parts.length > 1) {
      const committed = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
      const nextChips = [...chips, ...committed];
      const nextQuery = parts[parts.length - 1];
      setChips(nextChips);
      setQuery(nextQuery);
      emit(nextChips, nextQuery);
    } else {
      setQuery(raw);
      emit(chips, raw);
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
        commitEmail(matches[highlight].email);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        inputRef.current?.blur();
        return;
      }
    }
    if (event.key === 'Enter') {
      const trimmed = query.trim();
      if (emailPattern.test(trimmed)) {
        event.preventDefault();
        commitEmail(trimmed);
      }
      return;
    }
    if (event.key === 'Backspace' && query === '' && chips.length > 0) {
      event.preventDefault();
      removeChip(chips.length - 1);
    }
  }

  function handleBlur() {
    const trimmed = query.trim();
    if (emailPattern.test(trimmed)) {
      commitEmail(trimmed);
    }
    setFocused(false);
  }

  function chipDisplayName(email: string) {
    const entry = contactSearchEntries.find(
      (candidate) => candidate.contact.email.toLowerCase() === email.toLowerCase(),
    );
    return entry?.contact.name ?? email;
  }

  return (
    <div className="composer-recipient-field">
      <label className="composer-field-row">
        <span>{label}</span>
        <div className="composer-recipient-editor">
          {chips.map((chip, index) => (
            <span className="composer-recipient-chip" key={`${chip}-${index}`}>
              <span className="composer-recipient-chip-copy" title={chip}>{chipDisplayName(chip)}</span>
              <button
                type="button"
                aria-label={`移除 ${chip}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => removeChip(index)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            autoComplete="off"
            value={query}
            placeholder={chips.length === 0 ? placeholder : ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setFocused(true);
              setHighlight(0);
            }}
            onBlur={handleBlur}
          />
        </div>
      </label>

      {focused && matches.length > 0 && (
        <div className="recipient-suggestions">
          <span>匹配联系人</span>
          {matches.map((contact, index) => (
            <button
              type="button"
              key={contact.id}
              className={index === highlight ? 'is-active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => commitEmail(contact.email)}
            >
              <strong>{contact.name || contact.email}</strong>
              <small>{contact.email}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
