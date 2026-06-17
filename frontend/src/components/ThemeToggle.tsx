import { useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, saveTheme, type ThemeMode } from '../theme';

function nextTheme(theme: ThemeMode): ThemeMode {
  return theme === 'dark' ? 'light' : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const targetTheme = nextTheme(theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const next = nextTheme(current);
      saveTheme(next);
      return next;
    });
  }

  return (
    <button
      className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-field px-4 py-3 text-sm font-semibold text-text shadow-sm transition hover:border-accent-border hover:bg-accent-soft"
      type="button"
      aria-label={`Switch to ${targetTheme} theme`}
      aria-pressed={theme === 'dark'}
      data-theme-toggle={theme}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      <span className="sr-only">Current theme is {theme}.</span>
    </button>
  );
}
