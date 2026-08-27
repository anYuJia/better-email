from pathlib import Path

path = Path('src/components/composer/RecipientField.tsx')
text = path.read_text(encoding='utf-8')
old = """  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    if (composingRef.current || event.nativeEvent.isComposing) {
"""
new = """  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const nativeEvent = event.nativeEvent as InputEvent;
    if (composingRef.current || nativeEvent.isComposing) {
"""
if text.count(old) != 1:
    raise SystemExit(f'native event block count={text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
