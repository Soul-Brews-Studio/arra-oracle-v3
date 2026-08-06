import type { ThemeDefinition } from './types';

export const midnightTeal: ThemeDefinition = {
  id: 'midnight-teal',
  name: 'Midnight Teal',
  description: 'Deep navy background with teal accents — darker Oracle vibe',
  light: {
    '--color-bg': 'oklch(0.96 0.006 220)',
    '--color-accent': 'oklch(0.45 0.12 178)',
    '--color-accent2': 'oklch(0.50 0.18 300)',
    '--color-accent-solid': 'oklch(0.72 0.14 178)',
    '--color-accent-hover': 'oklch(0.80 0.10 178)',
    '--color-accent-soft': 'oklch(0.92 0.06 178 / 0.72)',
    '--color-accent-border': 'oklch(0.45 0.12 178 / 0.36)',
    '--glass-bg': 'oklch(1 0 0 / 0.52)',
    '--glass-border': 'oklch(0.45 0.12 178 / 0.20)',
  },
  dark: {
    '--color-bg': 'oklch(0.08 0.02 265)',
    '--color-surface': 'oklch(0.15 0.02 260 / 0.7)',
    '--color-surface-muted': 'oklch(0.19 0.02 260 / 0.58)',
    '--color-accent': 'oklch(0.82 0.13 178)',
    '--color-accent2': 'oklch(0.78 0.16 300)',
    '--color-accent-solid': 'oklch(0.82 0.13 178)',
    '--color-accent-hover': 'oklch(0.88 0.10 178)',
    '--glass-bg': 'oklch(0.12 0.02 265 / 0.40)',
    '--glass-border': 'oklch(1 0 0 / 0.06)',
    '--glass-shadow': '0 8px 36px oklch(0 0 0 / 0.5)',
  },
};
