import { useEffect, useRef, useState } from 'react';
import { getThemes } from '../themes/registry';
import { applyColorTheme, clearColorThemeOverrides, readStoredColorTheme, saveColorTheme } from '../theme';

export function ThemeSelector() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(() => readStoredColorTheme());
  const panelRef = useRef<HTMLDivElement>(null);
  const themes = getThemes();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  function handlePreview(id: string) {
    clearColorThemeOverrides();
    applyColorTheme(id);
  }

  function handleSelect(id: string) {
    saveColorTheme(id);
    setActiveId(id);
    setOpen(false);
  }

  function handleLeave() {
    clearColorThemeOverrides();
    applyColorTheme(activeId);
  }

  const active = themes.find((t) => t.id === activeId);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="focus-ring inline-flex items-center gap-2 rounded-xl border border-border bg-field px-3 py-2 text-sm font-semibold text-text shadow-sm transition hover:border-accent-border hover:bg-accent-soft"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select color theme"
      >
        <ThemeSwatch theme={active} />
        <span className="hidden sm:inline">{active?.name ?? 'Theme'}</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Color themes"
          className="glass absolute right-0 top-full z-50 mt-2 grid max-h-[24rem] w-64 gap-1 overflow-y-auto rounded-2xl p-2"
          onMouseLeave={handleLeave}
        >
          {themes.map((t) => (
            <button
              key={t.id}
              role="option"
              type="button"
              aria-selected={t.id === activeId}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                t.id === activeId ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-muted'
              }`}
              onMouseEnter={() => handlePreview(t.id)}
              onClick={() => handleSelect(t.id)}
            >
              <ThemeSwatch theme={t} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.name}</p>
                <p className="truncate text-xs text-text-muted">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThemeSwatch({ theme }: { theme?: { light: Record<string, string>; dark: Record<string, string> } }) {
  const accent = theme?.dark['--color-accent'] ?? theme?.light['--color-accent'] ?? 'oklch(0.82 0.13 178)';
  const accent2 = theme?.dark['--color-accent2'] ?? theme?.light['--color-accent2'] ?? 'oklch(0.78 0.16 300)';
  return (
    <span className="inline-flex shrink-0 gap-0.5" aria-hidden="true">
      <span className="h-4 w-4 rounded-full" style={{ background: accent }} />
      <span className="h-4 w-4 rounded-full" style={{ background: accent2 }} />
    </span>
  );
}
