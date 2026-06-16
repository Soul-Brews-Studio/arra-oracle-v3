export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'ARRA_FRONTEND_THEME';

function browserWindow(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function systemTheme(): ThemeMode {
  return browserWindow()?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function readStoredTheme(): ThemeMode {
  try {
    const stored = browserWindow()?.localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : systemTheme();
  } catch {
    return systemTheme();
  }
}

export function applyTheme(theme: ThemeMode) {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!root) return;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function loadTheme(): ThemeMode {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}

export function saveTheme(theme: ThemeMode) {
  try {
    browserWindow()?.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage can be unavailable in privacy-restricted contexts.
  }
  applyTheme(theme);
}
