import { describe, expect, test } from 'bun:test';
import { HealthHero, checkedAgo } from '../../../frontend/src/components/HealthHero';
import { HEALTH_STATE_COPY, HealthState } from '../../../frontend/src/components/simple/healthState';
import { htmlFor } from '../_render';

describe('HealthHero', () => {
  test('renders all health states with status semantics', () => {
    const html = Object.values(HealthState).map((state) => htmlFor(
      <HealthHero state={state} checkedAt={1_000} onAction={() => {}} />,
    )).join('\n');

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    for (const state of Object.values(HealthState)) {
      const copy = HEALTH_STATE_COPY[state];
      expect(html).toContain(copy.title.replace("Can't", 'Can&#x27;t'));
      expect(html).toContain(copy.action);
    }
  });

  test('renders checked age', () => {
    expect(checkedAgo(1_000, 12_400)).toBe('checked 11s ago');
    expect(checkedAgo(null)).toBe('not checked yet');
  });
});
