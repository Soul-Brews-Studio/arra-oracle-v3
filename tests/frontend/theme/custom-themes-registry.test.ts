import { describe, expect, test } from 'bun:test';
import { getTheme, getThemes } from '../../../frontend/src/themes/index';

describe('custom color themes', () => {
  test('registers Solar Amber with light and dark amber tokens', () => {
    const theme = getTheme('solar-amber');
    expect(getThemes().map((item) => item.id)).toContain('solar-amber');
    expect(theme?.name).toBe('Solar Amber');
    expect(theme?.light['--color-accent']).toBe('oklch(0.75 0.15 70)');
    expect(theme?.light['--color-accent2']).toBe('oklch(0.70 0.12 40)');
    expect(theme?.dark['--color-accent']).toBe('oklch(0.75 0.15 70)');
    expect(theme?.dark['--color-accent2']).toBe('oklch(0.70 0.12 40)');
  });

  test('registers Ocean Depth with light and dark ocean tokens', () => {
    const theme = getTheme('ocean-depth');
    expect(getThemes().map((item) => item.id)).toContain('ocean-depth');
    expect(theme?.name).toBe('Ocean Depth');
    expect(theme?.light['--color-accent']).toBe('oklch(0.72 0.12 210)');
    expect(theme?.light['--color-accent2']).toBe('oklch(0.68 0.10 240)');
    expect(theme?.dark['--color-accent']).toBe('oklch(0.72 0.12 210)');
    expect(theme?.dark['--color-accent2']).toBe('oklch(0.68 0.10 240)');
  });

  test('registers Ivory Gold with light and dark gold tokens', () => {
    const theme = getTheme('ivory-gold');
    expect(getThemes().map((item) => item.id)).toContain('ivory-gold');
    expect(theme?.name).toBe('Ivory Gold');
    expect(theme?.light['--color-accent']).toBe('oklch(0.78 0.10 85)');
    expect(theme?.light['--color-accent2']).toBe('oklch(0.70 0.08 60)');
    expect(theme?.dark['--color-accent']).toBe('oklch(0.78 0.10 85)');
    expect(theme?.dark['--color-accent2']).toBe('oklch(0.70 0.08 60)');
  });

});
