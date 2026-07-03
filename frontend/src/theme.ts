import { DEFAULT_THEME_ID, getTheme } from './themes/index';

export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'ARRA_FRONTEND_THEME';
export const COLOR_THEME_KEY = 'ARRA_FRONTEND_COLOR_THEME';

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

export function readStoredColorTheme(): string {
  try {
    return browserWindow()?.localStorage.getItem(COLOR_THEME_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
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

export function applyColorTheme(themeId: string) {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!root) return;
  const theme = getTheme(themeId);
  if (!theme) return;

  root.dataset.colorTheme = themeId;
  const mode = root.classList.contains('dark') ? 'dark' : 'light';
  const tokens = mode === 'dark' ? theme.dark : theme.light;

  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

export function clearColorThemeOverrides() {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!root) return;
  const vars = root.style.cssText.match(/--[\w-]+/g) || [];
  for (const v of vars) root.style.removeProperty(v);
}

export function saveColorTheme(themeId: string) {
  try {
    browserWindow()?.localStorage.setItem(COLOR_THEME_KEY, themeId);
  } catch {}
  clearColorThemeOverrides();
  applyColorTheme(themeId);
}

export function loadTheme(): ThemeMode {
  const theme = readStoredTheme();
  applyTheme(theme);
  const colorTheme = readStoredColorTheme();
  applyColorTheme(colorTheme);
  return theme;
}

export function saveTheme(theme: ThemeMode) {
  try {
    browserWindow()?.localStorage.setItem(THEME_KEY, theme);
  } catch {}
  applyTheme(theme);
  const colorTheme = readStoredColorTheme();
  applyColorTheme(colorTheme);
}
