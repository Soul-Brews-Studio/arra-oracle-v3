import { describe, expect, test } from "bun:test";
import { computeVersion, nextCalendarBase } from "../../../scripts/calver-core.ts";

function localDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("CalVer collision guard", () => {
  test("same-minute collision skips to next day", () => {
    const version = computeVersion(
      { stable: false, now: localDate(2026, 7, 5, 16, 8) },
      ["v26.7.5-alpha.1608"],
      "",
    );

    expect(version).toBe("26.7.6-alpha.1608");
  });

  test("clock skew below package.json max skips to next day", () => {
    const version = computeVersion(
      { stable: false, now: localDate(2026, 7, 5, 15, 30) },
      [],
      "26.7.5-alpha.1608",
    );

    expect(version).toBe("26.7.6-alpha.1530");
  });

  test("later-time cut stays on today's base", () => {
    const version = computeVersion(
      { stable: false, now: localDate(2026, 7, 5, 16, 9) },
      ["v26.7.5-alpha.1608"],
      "26.7.5-alpha.1607",
    );

    expect(version).toBe("26.7.5-alpha.1609");
  });

  test("collision guard handles month and year rollover", () => {
    const version = computeVersion(
      { stable: false, now: localDate(2026, 12, 31, 0, 5) },
      ["v26.12.31-alpha.5"],
      "",
    );

    expect(nextCalendarBase("26.7.31")).toBe("26.8.1");
    expect(version).toBe("27.1.1-alpha.5");
  });
});
