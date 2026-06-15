export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'ARRA_FRONTEND_THEME';

function systemTheme(): ThemeMode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function readStoredTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : systemTheme();
}

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function saveTheme(theme: ThemeMode) {
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
