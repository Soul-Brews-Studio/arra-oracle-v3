import type { UnifiedMenuManifest } from '../../plugins/unified-manifest.ts';
import type { MenuItem } from './model.ts';

export type UnifiedMenuLike = UnifiedMenuManifest & { plugin?: string };

export function menuItemsFromUnifiedPlugins(source: UnifiedMenuLike[]): MenuItem[] {
  return source.map((item) => {
    const menuItem: MenuItem = {
      path: item.path,
      label: item.label,
      group: item.group ?? 'tools',
      order: item.order ?? 999,
      source: 'plugin',
    };
    if (item.icon) menuItem.icon = item.icon;
    if (item.plugin) menuItem.sourceName = item.plugin;
    return menuItem;
  });
}
