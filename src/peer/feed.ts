import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join, relative } from 'path';
import { FEED_LOG, REPO_ROOT } from '../config.ts';
import { nodeName } from './identity.ts';
export interface PeerFeedItem { id: string; title: string; url?: string; ts: string; summary?: string; source?: string; }
function capLimit(limit: unknown) { const n = Number(limit ?? 20); return Math.min(100, Math.max(1, Number.isFinite(n) ? Math.trunc(n) : 20)); }
function titleFrom(path: string, text: string) { return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path, extname(path)); }
function walk(dir: string, out: string[] = []): string[] { if (!existsSync(dir)) return out; for (const ent of readdirSync(dir, { withFileTypes: true })) { if (['node_modules','.git','.omx','agents'].includes(ent.name)) continue; const p = join(dir, ent.name); if (ent.isDirectory()) walk(p, out); else if (/\.(md|mdx|txt)$/i.test(ent.name)) out.push(p); } return out; }
function feedLogItems(): PeerFeedItem[] { if (!existsSync(FEED_LOG)) return []; return readFileSync(FEED_LOG, 'utf8').split(/\n+/).filter(Boolean).slice(-200).map((line, i) => { try { const v = JSON.parse(line); return { id: String(v.id ?? `feed-log-${i}`), title: String(v.title ?? v.event ?? 'Feed item'), ts: String(v.ts ?? v.createdAt ?? new Date().toISOString()), summary: v.summary ?? v.text ?? undefined, source: 'feed-log' }; } catch { return { id: `feed-log-${i}`, title: line.slice(0, 80), ts: new Date().toISOString(), summary: line, source: 'feed-log' }; } }); }
export async function getPeerFeed(limitArg?: unknown) {
  const limit = capLimit(limitArg);
  const items = feedLogItems();
  if (items.length < limit) {
    for (const file of walk(REPO_ROOT).sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, limit * 2)) {
      const text = readFileSync(file, 'utf8'); const st = statSync(file);
      items.push({ id: relative(REPO_ROOT, file), title: titleFrom(file, text), ts: st.mtime.toISOString(), summary: text.replace(/\s+/g, ' ').slice(0, 240), source: 'filesystem' });
      if (items.length >= limit) break;
    }
  }
  return { node: nodeName(), oracle: 'arra', ts: Date.now(), items: items.slice(0, limit) };
}
