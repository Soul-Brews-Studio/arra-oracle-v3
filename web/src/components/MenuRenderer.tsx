import React from "react";
import { studioHref } from "hook-menu/studio";
import type { MenuItem } from "../hooks/useMenu";

const GROUP_LABELS: Record<MenuItem["group"], string> = {
  main: "Main",
  tools: "Tools",
  admin: "Admin",
  hidden: "Hidden",
};

export interface MenuRendererProps {
  items: MenuItem[];
  currentHost?: string;
  loading?: boolean;
  error?: Error | string | null;
  showHidden?: boolean;
  emptyLabel?: string;
  className?: string;
}

export function MenuRenderer({
  items,
  currentHost = "",
  loading = false,
  error = null,
  showHidden = false,
  emptyLabel = "No menu items",
  className = "arra-menu",
}: MenuRendererProps) {
  if (loading) return <p className={`${className}__status`}>Loading menu…</p>;
  if (error) return <p className={`${className}__status ${className}__status--error`}>{String(error instanceof Error ? error.message : error)}</p>;

  const visibleItems = items
    .filter((item) => showHidden || (item.group !== "hidden" && !item.hidden))
    .slice()
    .sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.label.localeCompare(b.label));

  if (visibleItems.length === 0) return <p className={`${className}__status`}>{emptyLabel}</p>;

  const groups = visibleItems.reduce<Record<string, MenuItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <nav className={className} aria-label="Oracle menu">
      {Object.entries(groups).map(([group, groupItems]) => (
        <section className={`${className}__group`} data-menu-group={group} key={group}>
          <h2 className={`${className}__heading`}>{GROUP_LABELS[group as MenuItem["group"]] ?? group}</h2>
          <ul className={`${className}__list`}>
            {groupItems.map((item) => (
              <li className={`${className}__item`} key={`${item.group}:${item.path}`}>
                <a className={`${className}__link`} href={studioHref(item, currentHost)}>
                  {item.icon ? <span className={`${className}__icon`} aria-hidden="true">{item.icon}</span> : null}
                  <span>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export default MenuRenderer;
