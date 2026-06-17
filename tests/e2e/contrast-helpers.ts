import type { Page } from '@playwright/test';

export type ContrastFailure = { text: string; ratio: number; color: string; background: string };

export async function contrastFailures(page: Page, minimum = 4.5): Promise<ContrastFailure[]> {
  return page.evaluate((min) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const oklchToRgb = (l: number, c: number, h: number, a = 1): Rgba => {
      const radians = h * Math.PI / 180;
      const okA = c * Math.cos(radians);
      const okB = c * Math.sin(radians);
      const l1 = l + 0.3963377774 * okA + 0.2158037573 * okB;
      const m1 = l - 0.1055613458 * okA - 0.0638541728 * okB;
      const s1 = l - 0.0894841775 * okA - 1.2914855480 * okB;
      const L = l1 ** 3;
      const M = m1 ** 3;
      const S = s1 ** 3;
      const linear = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S];
      const gamma = (value: number) => value <= 0.0031308 ? 12.92 * value : 1.055 * (value ** (1 / 2.4)) - 0.055;
      return { r: clamp(gamma(linear[0])), g: clamp(gamma(linear[1])), b: clamp(gamma(linear[2])), a };
    };
    const parse = (input: string): Rgba => {
      const value = input.trim();
      if (!value || value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      if (value.startsWith('oklch(')) {
        const parts = value.slice(6, -1).replace('/', ' ').split(/\s+/).filter(Boolean);
        const l = parts[0].endsWith('%') ? Number.parseFloat(parts[0]) / 100 : Number(parts[0]);
        const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
        return oklchToRgb(l, Number.parseFloat(parts[1]), Number.parseFloat(parts[2]), Number.isFinite(a) ? a : 1);
      }
      if (value.startsWith('oklab(')) {
        const parts = value.slice(6, -1).replace('/', ' ').split(/\s+/).filter(Boolean);
        const l = parts[0].endsWith('%') ? Number.parseFloat(parts[0]) / 100 : Number(parts[0]);
        const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
        const c = Math.hypot(Number.parseFloat(parts[1]), Number.parseFloat(parts[2]));
        const h = Math.atan2(Number.parseFloat(parts[2]), Number.parseFloat(parts[1])) * 180 / Math.PI;
        return oklchToRgb(l, c, h, Number.isFinite(a) ? a : 1);
      }
      const numbers = value.match(/-?\d*\.?\d+%?/g)?.map((part) => part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part)) ?? [];
      if (value.startsWith('color(')) return { r: clamp(numbers[0]), g: clamp(numbers[1]), b: clamp(numbers[2]), a: numbers[3] ?? 1 };
      return { r: clamp((numbers[0] ?? 0) / 255), g: clamp((numbers[1] ?? 0) / 255), b: clamp((numbers[2] ?? 0) / 255), a: numbers[3] ?? 1 };
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top.a + bottom.a * (1 - top.a);
      return a ? { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a } : { r: 0, g: 0, b: 0, a: 0 };
    };
    const luminance = (color: Rgba): number => {
      const channel = (value: number) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const backgroundFor = (element: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) layers.push(parse(getComputedStyle(node).backgroundColor));
      return layers.reverse().reduce((acc, color) => over(color, acc), { r: 1, g: 1, b: 1, a: 1 });
    };
    const ownText = (element: Element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim());
    const isTextControl = (element: Element) => ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(element.tagName);
    const isVisible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    return [...document.body.querySelectorAll('*')].flatMap((node) => {
      if (!(ownText(node) || isTextControl(node)) || !isVisible(node) || node.closest('[disabled],[aria-hidden="true"]')) return [];
      const style = getComputedStyle(node);
      const foreground = parse(style.color);
      const background = backgroundFor(node);
      const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      const ratio = (light + 0.05) / (dark + 0.05);
      if (ratio >= min) return [];
      return [{ text: (node.textContent ?? (node as HTMLInputElement).value ?? '').trim().slice(0, 80), ratio, color: style.color, background: getComputedStyle(node).backgroundColor }];
    });
  }, minimum);
}
