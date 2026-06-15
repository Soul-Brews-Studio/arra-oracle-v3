import { useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, saveTheme, type ThemeMode } from '../theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      className="focus-ring rounded-xl border border-slate-300/70 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-teal-300/40"
      type="button"
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
    >
      {theme === 'dark' ? '☾ Dark' : '☀ Light'}
    </button>
  );
}
