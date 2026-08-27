from pathlib import Path


def replace_if_present(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    if new in text:
        return
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected one old block, got {text.count(old)}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


recipient = Path('src/components/composer/RecipientField.tsx')
replace_if_present(
    recipient,
    """  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    if (composingRef.current || event.nativeEvent.isComposing) {
""",
    """  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const nativeEvent = event.nativeEvent as InputEvent;
    if (composingRef.current || nativeEvent.isComposing) {
""",
    'recipient native event',
)

primary_test = Path('src/components/composer/ComposerPrimaryFields.test.tsx')
replace_if_present(
    primary_test,
    """    recipient.setSelectionRange(4, 4);
""",
    """    (recipient as HTMLInputElement).setSelectionRange(4, 4);
""",
    'recipient test input type',
)
