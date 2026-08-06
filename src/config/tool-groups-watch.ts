import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';
import { loadToolGroupConfig, type ToolGroupConfig } from './tool-groups-core.ts';

export function watchToolGroupConfig(
  onChange: (next: ToolGroupConfig) => void,
  repoRoot?: string,
): () => void {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  const localPath = path.join(root, 'arra.config.json');
  const localPluginsPath = path.join(root, 'plugins.json');
  const globalPath = path.join(ORACLE_DATA_DIR, 'config.json');
  const globalPluginsPath = path.join(ORACLE_DATA_DIR, 'plugins.json');
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let last = JSON.stringify(loadToolGroupConfig(root));

  const reloadIfChanged = (): void => {
    const next = loadToolGroupConfig(root);
    const serialized = JSON.stringify(next);
    if (serialized === last) return;
    last = serialized;
    console.error('[ToolGroups] Config changed — reloading');
    onChange(next);
  };

  const tick = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reloadIfChanged();
    }, 200);
  };

  const byDir = new Map<string, Set<string>>();
  for (const target of [localPath, localPluginsPath, globalPath, globalPluginsPath]) {
    const dir = path.dirname(target);
    const names = byDir.get(dir) ?? new Set<string>();
    names.add(path.basename(target));
    byDir.set(dir, names);
    try {
      if (fs.existsSync(target)) watchers.push(fs.watch(target, { persistent: false }, tick));
    } catch {}
  }

  poller = setInterval(reloadIfChanged, 100);
  poller.unref?.();

  for (const [dir, names] of byDir) {
    try {
      if (!fs.existsSync(dir)) continue;
      watchers.push(fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename) { tick(); return; }
        const changed = Buffer.isBuffer(filename) ? filename.toString() : String(filename);
        if (names.has(changed)) tick();
      }));
    } catch {}
  }

  return () => {
    if (timer) clearTimeout(timer);
    if (poller) clearInterval(poller);
    for (const watcher of watchers) {
      try { watcher.close(); } catch {}
    }
  };
}
