import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CustomSelect } from './CustomSelect';

describe('CustomSelect', () => {
  afterEach(() => {
    cleanup();
  });

  const options = [
    { value: '5', label: '5 秒' },
    { value: '10', label: '10 秒', meta: '推荐' },
    { value: '30', label: '30 秒' },
  ];

  const ariaLabel = '撤销发送延迟';

  function getCombobox(expanded = false) {
    return screen.getByRole('combobox', { name: ariaLabel, expanded });
  }

  function getActiveOption(combobox: HTMLElement) {
    const activeId = combobox.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();
    const option = document.getElementById(activeId!);
    expect(option).not.toBeNull();
    return option!;
  }

  it('exposes the selected value as a labelled, collapsed combobox', () => {
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="10"
        options={options}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText('10 秒')).not.toBeNull();
    expect(screen.getByText('推荐')).not.toBeNull();
    const combobox = getCombobox();
    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox');
    expect(combobox.getAttribute('aria-controls')).not.toBeNull();
    expect(combobox.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('wires aria-controls and aria-activedescendant to the portalled listbox', () => {
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="10"
        options={options}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(getCombobox());
    const combobox = getCombobox(true);
    const listbox = screen.getByRole('listbox', { name: ariaLabel });
    const selectedOption = screen.getByRole('option', { name: /10 秒/ });
    expect(combobox.getAttribute('aria-controls')).toBe(listbox.id);
    expect(combobox.getAttribute('aria-activedescendant')).toBe(selectedOption.id);
    expect(selectedOption.getAttribute('aria-selected')).toBe('true');
  });

  it('opens the option list and selects a value with the pointer', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        onChange={onChange}
      />,
    );
    const combobox = getCombobox();
    combobox.focus();
    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole('option', { name: /30 秒/ }));

    expect(onChange).toHaveBeenCalledWith('30');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(combobox);
  });

  it('navigates with arrows and Home/End while skipping disabled options', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        disabledValues={['10']}
        onChange={onChange}
      />,
    );
    const combobox = getCombobox();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(getActiveOption(combobox).textContent).toContain('5 秒');
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(getActiveOption(combobox).textContent).toContain('30 秒');
    fireEvent.keyDown(combobox, { key: 'ArrowUp' });
    expect(getActiveOption(combobox).textContent).toContain('5 秒');
    fireEvent.keyDown(combobox, { key: 'End' });
    expect(getActiveOption(combobox).textContent).toContain('30 秒');
    fireEvent.keyDown(combobox, { key: 'Home' });
    expect(getActiveOption(combobox).textContent).toContain('5 秒');

    const disabledOption = screen.getByRole('option', { name: /10 秒/ });
    expect(disabledOption.getAttribute('aria-disabled')).toBe('true');
    expect((disabledOption as HTMLElement).tabIndex).toBe(-1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the active option with Enter or Space', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        onChange={onChange}
      />,
    );
    const combobox = getCombobox();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('10');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(combobox, { key: ' ' });
    fireEvent.keyDown(combobox, { key: 'End' });
    fireEvent.keyDown(combobox, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('30');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('supports buffered typeahead and repeated-character cycling', () => {
    const onChange = vi.fn();
    const typeaheadOptions = [
      { value: 'alpha', label: 'Alpha' },
      { value: 'alpine', label: 'Alpine' },
      { value: 'bravo', label: 'Bravo' },
      { value: 'beta', label: 'Beta' },
    ];
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="alpha"
        options={typeaheadOptions}
        onChange={onChange}
      />,
    );
    const combobox = getCombobox();

    fireEvent.keyDown(combobox, { key: 'b' });
    expect(getActiveOption(combobox).textContent).toContain('Bravo');
    fireEvent.keyDown(combobox, { key: 'e' });
    expect(getActiveOption(combobox).textContent).toContain('Beta');
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(combobox, { key: 'a' });
    expect(getActiveOption(combobox).textContent).toContain('Alpine');
    fireEvent.keyDown(combobox, { key: 'a' });
    expect(getActiveOption(combobox).textContent).toContain('Alpha');
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('alpha');
  });

  it('clears an unmatched typeahead query so the next key can match', () => {
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        onChange={() => undefined}
      />,
    );
    const combobox = getCombobox();

    fireEvent.keyDown(combobox, { key: 'x' });
    expect(screen.getByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(combobox, { key: '3' });
    expect(getActiveOption(combobox).textContent).toContain('30 秒');
  });

  it('cancels a hovered option when an outside pointer closes the menu', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        onChange={onChange}
      />,
    );
    const combobox = getCombobox();

    fireEvent.click(combobox);
    fireEvent.mouseEnter(screen.getByRole('option', { name: /30 秒/ }));
    expect(getActiveOption(combobox).textContent).toContain('30 秒');
    fireEvent.pointerDown(document.body);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape without committing and restores focus', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        onChange={onChange}
      />,
    );
    const combobox = getCombobox();
    combobox.focus();
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'End' });
    fireEvent.keyDown(combobox, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(combobox);
  });

  it('commits on Tab but cancels an ordinary blur without trapping focus', () => {
    const onChange = vi.fn();
    render(
      <>
        <CustomSelect
          ariaLabel={ariaLabel}
          value="5"
          options={options}
          onChange={onChange}
        />
        <button type="button">下一项</button>
      </>,
    );
    const combobox = getCombobox();
    const nextButton = screen.getByRole('button', { name: '下一项' });

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'End' });
    fireEvent.keyDown(combobox, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('30');

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.blur(combobox, { relatedTarget: nextButton });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('30');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lets a modal elevate its body-portal menu above the modal backdrop', () => {
    render(
      <CustomSelect
        ariaLabel={ariaLabel}
        value="5"
        options={options}
        portalZIndex={2650}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(getCombobox());
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('data-portal-layer')).toBe('2650');
    expect((listbox as HTMLElement).style.zIndex).toBe('2650');
  });
});
