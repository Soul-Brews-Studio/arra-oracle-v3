import { useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, saveTheme, type ThemeMode } from '../theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      saveTheme(next);
      return next;
    });
  }

  return (
    <button
      className="focus-ring rounded-xl border border-border/70 bg-surface px-4 py-3 text-sm font-semibold text-text shadow-sm transition hover:bg-field dark:border-border dark:bg-surface-muted dark:text-text dark:hover:border-accent-border"
      type="button"
      aria-label="Dark mode"
      aria-pressed={theme === 'dark'}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? '☾ Dark' : '☀ Light'}
    </button>
  );
}
