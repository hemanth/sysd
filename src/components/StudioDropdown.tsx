import React, { useEffect, useId, useRef, useState } from 'react';
import { IconCheck, IconChevronDown } from './Icons';

export interface StudioDropdownOption<T extends string = string> {
  value: T;
  label: string;
  subtitle?: string;
  badge?: string;
}

interface StudioDropdownProps<T extends string = string> {
  value: T;
  options: StudioDropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  triggerLabel?: string;
  triggerBadge?: string;
  menuWidth?: number;
  align?: 'left' | 'right';
  id?: string;
}

export function StudioDropdown<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  triggerLabel,
  triggerBadge,
  menuWidth = 300,
  align = 'left',
  id,
}: StudioDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActiveIdx(Math.max(0, options.findIndex((o) => o.value === value)));

    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, options, value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = options[activeIdx];
      if (target) {
        onChange(target.value);
        setOpen(false);
      }
    }
  };

  return (
    <div className="studio-dropdown" ref={wrapRef} id={id}>
      <button
        type="button"
        className={`studio-dropdown-trigger ${open ? 'open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className="studio-dropdown-label">{triggerLabel ?? selected?.label}</span>
        {triggerBadge && <span className="tag-pill hide-mobile">{triggerBadge}</span>}
        <IconChevronDown size={13} className={`studio-dropdown-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`studio-dropdown-menu align-${align}`}
          style={{ width: menuWidth }}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === activeIdx;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`studio-dropdown-item ${isSelected ? 'selected' : ''} ${
                  isFocused ? 'focused' : ''
                }`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="studio-dropdown-check" aria-hidden="true">
                  {isSelected ? <IconCheck size={12} /> : null}
                </span>
                <span className="studio-dropdown-copy">
                  <span className="studio-dropdown-item-title">{opt.label}</span>
                  {opt.subtitle && (
                    <span className="studio-dropdown-item-sub">{opt.subtitle}</span>
                  )}
                </span>
                {opt.badge && <span className="tag-pill">{opt.badge}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
