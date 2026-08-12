import { useEffect, useId, useMemo, useRef, useState } from 'react';
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

const suggestionLimit = 4;
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
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const suggestionListId = useId();
  const lastValueRef = useRef(value);
  // Chip actions can run between controlled parent updates. Keep the latest
  // local state in refs so a click always removes exactly one chip.
  const chipsRef = useRef(chips);
  const queryRef = useRef(query);
  const inputRef = useRef<HTMLInputElement>(null);

  chipsRef.current = chips;
  queryRef.current = query;

  const matches = useMemo(
    () => (query.trim() ? matchingContacts(contactSearchEntries, query, suggestionLimit) : []),
    [contactSearchEntries, query],
  );
  const menuOpen = focused && matches.length > 0 && !suggestionsDismissed;
  const activeMatch = matches[highlight] ?? matches[0];
  const activeSuggestionId = menuOpen && activeMatch
    ? `${suggestionListId}-option-${activeMatch.id}`
    : undefined;

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    const { chips: nextChips, query: nextQuery } = initialParse(value);
    chipsRef.current = nextChips;
    queryRef.current = nextQuery;
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
    const currentChips = chipsRef.current;
    const nextChips = currentChips.some((chip) => chip.toLowerCase() === normalized)
      ? currentChips
      : [...currentChips, email.trim()];
    chipsRef.current = nextChips;
    queryRef.current = '';
    setChips(nextChips);
    setQuery('');
    emit(nextChips, '');
    setHighlight(0);
  }

  function removeChip(index: number) {
    const currentChips = chipsRef.current;
    if (index < 0 || index >= currentChips.length) return;
    const nextChips = currentChips.filter((_, chipIndex) => chipIndex !== index);
    chipsRef.current = nextChips;
    setChips(nextChips);
    emit(nextChips, queryRef.current);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSuggestionsDismissed(false);
    const raw = event.target.value;
    const parts = raw.split(/[;,]/);
    if (parts.length > 1) {
      const committed = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
      const nextChips = [...chipsRef.current, ...committed];
      const nextQuery = parts[parts.length - 1];
      chipsRef.current = nextChips;
      queryRef.current = nextQuery;
      setChips(nextChips);
      setQuery(nextQuery);
      emit(nextChips, nextQuery);
    } else {
      queryRef.current = raw;
      setQuery(raw);
      emit(chipsRef.current, raw);
    }
    setHighlight(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length > 0) {
      // Tab/Shift+Tab 按正常文档顺序离开字段（blur 时会提交悬空的合法邮箱），
      // 不得被建议循环困住。Arrow/Enter/Escape 只操作建议本身。
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
        // 关闭建议但保持焦点在输入框，用户可继续输入或按 Tab 离开。
        event.preventDefault();
        setHighlight(0);
        setSuggestionsDismissed(true);
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
    if (event.key === 'Backspace' && queryRef.current === '' && chipsRef.current.length > 0) {
      event.preventDefault();
      removeChip(chipsRef.current.length - 1);
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
                  // This button lives inside a label. Prevent the label's
                  // default activation so the input value and focus stay
                  // stable while removing exactly one chip.
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
            aria-autocomplete="list"
            aria-controls={menuOpen ? suggestionListId : undefined}
            aria-expanded={menuOpen}
            aria-activedescendant={activeSuggestionId}
            value={query}
            placeholder={chips.length === 0 ? placeholder : ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setFocused(true);
              setHighlight(0);
              setSuggestionsDismissed(false);
            }}
            onBlur={handleBlur}
          />
        </div>
      </label>

      {menuOpen && (
        <div className="recipient-suggestions" id={suggestionListId} role="listbox" aria-label={`${label}匹配联系人`}>
          <span aria-hidden="true">匹配联系人</span>
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
              <small>{contact.email}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
