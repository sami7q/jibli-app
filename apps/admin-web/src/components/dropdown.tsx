'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon';

/**
 * A select that opens downward and looks like a control.
 *
 * The native `<select>` was styled with no border on a transparent background,
 * which made it invisible as something you could click — and worse, a native
 * dropdown decides for itself which way to open. Near the bottom of a window it
 * opens *upward*, over the header, which on a filter bar two thirds down the
 * page is most of the time.
 *
 * So this is a listbox rather than a select. Three things it owes the native
 * control it replaces:
 *
 *   - keyboard: arrows move, Enter and Space choose, Escape closes, Home and
 *     End jump. A filter you can only reach with a mouse is a filter half the
 *     operators cannot use.
 *   - the label is real and tied to the button, so a screen reader announces
 *     what the value means rather than just reading it.
 *   - it closes on an outside click and on scroll, because a panel that floats
 *     over the page after you have moved on is worse than no panel.
 *
 * It opens downward and stays there. When there is genuinely no room the list
 * scrolls inside its own box rather than flipping — a control that sometimes
 * appears above and sometimes below is a control you have to look for twice.
 */

export interface DropdownOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Shown dimmed after the label — a count, a hint, a unit. */
  readonly note?: string;
}

export function Dropdown<T extends string>({
  value,
  onChange,
  options,
  label,
  allLabel,
  placeholder,
  disabled = false,
}: {
  value: T | '';
  onChange: (value: T | '') => void;
  options: readonly DropdownOption<T>[];
  label: string;
  /** When given, an "all" entry is prepended and the empty value is allowed. */
  allLabel?: string;
  /** Shown when nothing is chosen and there is no "all" entry. */
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const entries: DropdownOption<T | ''>[] = allLabel
    ? [{ value: '' as T | '', label: allLabel }, ...options]
    : [...options];

  const selectedIndex = entries.findIndex((entry) => entry.value === value);
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : undefined;

  // Open on the current value, not at the top: a list of nineteen governorates
  // should not make you scroll back to the one already chosen.
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture, because the page scrolls in a container rather than the window.
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const node = list.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const choose = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    onChange(entry.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((current) => Math.min(current + 1, entries.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(entries.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="dropdown" ref={container}>
      <span className="dropdown__label" id={`${id}-label`}>
        {label}
      </span>

      <button
        type="button"
        className={`dropdown__trigger${open ? ' dropdown__trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'dropdown__value' : 'dropdown__value dropdown__value--empty'}>
          {selected?.label ?? placeholder ?? label}
        </span>
        <Icon name="chevron" className="dropdown__chevron" flip={false} aria-hidden />
      </button>

      {open ? (
        <ul
          className="dropdown__list"
          role="listbox"
          aria-labelledby={`${id}-label`}
          ref={list}
          tabIndex={-1}
        >
          {entries.map((entry, index) => (
            <li
              key={entry.value || '__all__'}
              role="option"
              aria-selected={entry.value === value}
              className={
                'dropdown__option' +
                (index === active ? ' dropdown__option--active' : '') +
                (entry.value === value ? ' dropdown__option--selected' : '')
              }
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // Before blur, so the click is not swallowed by the outside
                // handler closing the panel first.
                event.preventDefault();
                choose(index);
              }}
            >
              <span>{entry.label}</span>
              {entry.note ? <span className="dropdown__note">{entry.note}</span> : null}
              {entry.value === value ? (
                <Icon name="check" className="dropdown__tick" aria-hidden />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
