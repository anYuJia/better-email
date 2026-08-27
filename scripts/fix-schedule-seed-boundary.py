from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)

component = Path('src/components/composer/ComposerSchedulePicker.tsx')
text = component.read_text(encoding='utf-8')
old = """function roundScheduleSeed() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
  if (date.getMinutes() === 60) date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}
"""
new = """function roundScheduleSeed() {
  const date = new Date();
  date.setSeconds(0, 0);
  // Always move to the *next* quarter-hour. Using Math.ceil kept an exact
  // 00/15/30/45 minute unchanged, and clearing seconds could turn the seed
  // into a time that had already passed by a few seconds.
  date.setMinutes(Math.floor(date.getMinutes() / 15) * 15 + 15);
  return date;
}
"""
component.write_text(replace_once(text, old, new, 'schedule seed'), encoding='utf-8')

test = Path('src/components/composer/ComposerSchedulePicker.test.tsx')
text = test.read_text(encoding='utf-8')
text = replace_once(
    text,
    """  afterEach(() => {
    cleanup();
  });
""",
    """  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
""",
    'test cleanup',
)
old_test = """  it('re-seeds an expired saved schedule before confirming', () => {
    const onChange = vi.fn();
    render(<ComposerSchedulePicker value={localValue(-3)} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(new Date(onChange.mock.calls[0][0]).getTime()).toBeGreaterThan(Date.now());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
"""
new_test = """  it('re-seeds an expired saved schedule to the next quarter-hour before confirming', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 27, 10, 30, 42));
    const onChange = vi.fn();
    render(<ComposerSchedulePicker value={localValue(-3)} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(new Date(onChange.mock.calls[0][0]).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(onChange.mock.calls[0][0]).getMinutes()).toBe(45);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
"""
test.write_text(replace_once(text, old_test, new_test, 'expired schedule test'), encoding='utf-8')
