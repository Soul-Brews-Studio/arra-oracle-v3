import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuRenderer } from "../MenuRenderer";
import { fetchMenuItems, normalizeMenuResponse, type MenuItem } from "../../hooks/useMenu";

const items: MenuItem[] = [
  { path: "/search", label: "Search", group: "main", order: 10, source: "page" },
  { path: "/tools", label: "Tools", group: "tools", order: 20, source: "page", studio: "tools.example.test" },
  { path: "/hidden", label: "Hidden", group: "hidden", order: 30, source: "api" },
];

describe("MenuRenderer", () => {
  test("renders visible hook-menu items and omits hidden by default", () => {
    const html = renderToStaticMarkup(<MenuRenderer items={items} currentHost="arra.example.test" />);

    expect(html).toContain("Search");
    expect(html).toContain("Tools");
    expect(html).not.toContain("Hidden");
    expect(html).toContain("https://tools.example.test/tools?host=arra.example.test");
  });

  test("can render hidden items when requested", () => {
    const html = renderToStaticMarkup(<MenuRenderer items={items} showHidden />);
    expect(html).toContain("Hidden");
  });
});

describe("useMenu helpers", () => {
  test("normalizes /api/menu response shape", () => {
    expect(normalizeMenuResponse({ items })).toEqual(items);
    expect(normalizeMenuResponse(items)).toEqual(items);
    expect(normalizeMenuResponse({})).toEqual([]);
  });

  test("fetchMenuItems resolves base url, host, and scope", async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ items }), { status: 200 });
    }) as typeof fetch;

    await expect(fetchMenuItems({ baseUrl: "http://localhost:47778/", host: "studio.test", scope: "main", fetcher })).resolves.toEqual(items);
    expect(seen[0]).toBe("http://localhost:47778/api/menu?host=studio.test&scope=main");
  });
});
