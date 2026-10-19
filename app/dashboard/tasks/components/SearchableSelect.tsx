"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiX } from "react-icons/fi";

export interface SelectOption {
  value: string;
  label: string;
  /** Extra text matched by the search box (defaults to the label). */
  searchText?: string;
}

interface BaseProps {
  options: SelectOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
}
interface SingleProps extends BaseProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}
interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

const triggerCls =
  "w-full p-2.5 border border-slate-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-[#ff9933] flex items-center justify-between gap-2 text-left cursor-pointer";

/**
 * Lightweight searchable dropdown (single or multi). While open it owns Escape
 * (closes only the dropdown, not the surrounding modal); every other key,
 * including Ctrl+Enter, bubbles so the modal's save shortcut keeps working.
 */
export default function SearchableSelect(props: SingleProps | MultiProps) {
  const { options, placeholder = "Select...", emptyText = "Koi result nahi mila", className = "" } = props;
  const selected: string[] = props.multiple ? props.value : props.value ? [props.value] : [];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mouseDown = useRef(false);
  const skipFocusOpen = useRef(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.searchText ?? o.label).toLowerCase().includes(q));
  }, [options, query]);

  const openDropdown = () => {
    // Flip upward when there is not enough room below (small screens / bottom of modal).
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 280 && rect.top > below);
    }
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const closeDropdown = (refocus = true) => {
    setOpen(false);
    if (refocus) {
      skipFocusOpen.current = true; // programmatic refocus must not re-open the list
      triggerRef.current?.focus();
    }
  };

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(opt: SelectOption) {
    if (props.multiple) {
      if (!selected.includes(opt.value)) props.onChange([...selected, opt.value]);
      // stay open so several users can be added quickly
      inputRef.current?.focus();
    } else {
      props.onChange(opt.value);
      closeDropdown();
    }
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // dropdown only - keep the modal open
      e.preventDefault();
      closeDropdown();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {props.multiple && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((v) => (
            <span key={v} className="text-xs font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded-full pl-2.5 pr-1 py-0.5 flex items-center gap-1">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => props.onChange(selected.filter((x) => x !== v))}
                className="p-0.5 rounded-full hover:bg-sky-100 cursor-pointer"
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className={triggerCls}
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={() => { mouseDown.current = true; }}
        onFocus={() => {
          if (skipFocusOpen.current) { skipFocusOpen.current = false; return; }
          if (!mouseDown.current && !open) openDropdown();
        }}
        onClick={() => { mouseDown.current = false; if (open) closeDropdown(false); else openDropdown(); }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); openDropdown(); }
        }}
      >
        <span className={`truncate ${!props.multiple && selected[0] ? "text-slate-800" : "text-slate-400"}`}>
          {!props.multiple && selected[0] ? labelOf(selected[0]) : placeholder}
        </span>
        <FiChevronDown className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          className={`absolute z-50 left-0 w-full max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onSearchKey}
            placeholder="Search..."
            className="w-full p-2.5 border-b border-slate-100 rounded-t-xl text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-[#ff9933]"
          />
          <ul ref={listRef} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o, i) => {
              const isSel = selected.includes(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
                  onClick={() => choose(o)}
                  className={`px-3 py-2 text-sm flex items-center justify-between gap-2 cursor-pointer ${i === active ? "bg-[#ff9933]/15" : ""} ${isSel ? "font-bold text-[#0a2540]" : "text-slate-700"}`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && <FiCheck className="shrink-0 text-emerald-600" />}
                </li>
              );
            })}
            {!filtered.length && <li className="px-3 py-3 text-xs font-bold text-slate-400">{emptyText}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
