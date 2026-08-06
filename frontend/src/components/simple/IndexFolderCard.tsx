import { invoke } from '@tauri-apps/api/core';
import { useMemo, useState, type FormEvent } from 'react';
import { API_HOST, isTauri } from '../../api/oracle';

export interface IndexFolderRuntime {
  tauri: boolean;
  localApi: boolean;
}

export interface IndexFolderCardProps {
  defaultExpanded?: boolean;
  initialPath?: string;
  onIndexFolder?: (folderPath: string) => Promise<string | void> | string | void;
  runtime?: IndexFolderRuntime;
}

type Status = 'idle' | 'copy' | 'running' | 'success' | 'error';

const buttonBase = 'focus-ring rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55';

export function isLocalOracleHost(host: string): boolean {
  const value = host.trim();
  if (!value) return false;
  const normalized = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function detectIndexFolderRuntime(): IndexFolderRuntime {
  return { tauri: isTauri(), localApi: isLocalOracleHost(API_HOST) };
}

export function mineCommandForPath(folderPath: string): string {
  const path = folderPath.trim();
  return `arra mine ${quoteShellArg(path || '<dir>')}`;
}

function quoteShellArg(value: string): string {
  if (value === '<dir>') return value;
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runDesktopMine(folderPath: string): Promise<string> {
  return await invoke<string>('mine_folder', { dir: folderPath });
}

export function IndexFolderCard({
  defaultExpanded = false,
  initialPath = '',
  onIndexFolder,
  runtime = detectIndexFolderRuntime(),
}: IndexFolderCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [folderPath, setFolderPath] = useState(initialPath);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const trimmedPath = folderPath.trim();
  const command = useMemo(() => mineCommandForPath(folderPath), [folderPath]);
  const runMine = onIndexFolder ?? (runtime.tauri ? runDesktopMine : undefined);
  const directIndexReady = Boolean(runMine && (runtime.tauri || runtime.localApi));
  const title = directIndexReady ? 'Index this folder now' : gateTitle(runtime);

  async function copyCommand() {
    try {
      await navigator.clipboard?.writeText(command);
      setStatus('copy');
      setMessage('Command copied. Paste it into a local terminal to index this folder.');
    } catch {
      setStatus('copy');
      setMessage('Copy the command below into a local terminal to index this folder.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedPath) {
      setStatus('error');
      setMessage('Enter a folder path first.');
      return;
    }
    if (!runMine || !directIndexReady) {
      await copyCommand();
      return;
    }
    setStatus('running');
    setMessage('Indexing folder…');
    try {
      const detail = await runMine(trimmedPath);
      setStatus('success');
      setMessage(detail || 'Folder indexing started. Search will update as Oracle ingests the notes.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="index-folder-title">
      <button
        aria-controls="index-folder-panel"
        aria-expanded={expanded}
        className="focus-ring flex w-full items-center justify-between gap-4 text-left"
        type="button"
        onClick={() => setExpanded((value) => !value)}
      >
        <span>
          <span id="index-folder-title" className="block text-lg font-semibold text-text">Add a whole folder of notes</span>
          <span className="mt-1 block text-sm text-text-muted">Mine Markdown, MDX, and text files into Oracle memory.</span>
        </span>
        <span aria-hidden="true" className="text-2xl text-accent">{expanded ? '−' : '+'}</span>
      </button>

      {expanded ? (
        <div id="index-folder-panel" className="mt-5 grid gap-4">
          <form className="grid gap-3" onSubmit={submit}>
            <label className="text-sm font-semibold text-text" htmlFor="simple-index-folder-path">Folder path</label>
            <input
              id="simple-index-folder-path"
              className="w-full rounded-2xl border border-border bg-field px-4 py-3 text-sm text-text outline-none focus:border-accent"
              placeholder="/Users/alex/notes"
              value={folderPath}
              onChange={(event) => setFolderPath(event.currentTarget.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={`${buttonBase} bg-accent-solid text-on-accent hover:bg-accent-hover`}
                disabled={!trimmedPath || !directIndexReady || status === 'running'}
                title={title}
                type="submit"
              >
                {status === 'running' ? 'Indexing…' : 'Index folder'}
              </button>
              {!directIndexReady ? <span className="text-xs text-text-muted">{gateCopy(runtime)}</span> : null}
            </div>
          </form>

          {!directIndexReady ? (
            <div className="rounded-2xl border border-accent-border bg-accent-soft/40 p-4 text-sm text-text">
              <p className="font-semibold">CLI fallback</p>
              <p className="mt-1 text-text-muted">Copy-paste this on the machine that can read the folder:</p>
              <code className="mt-3 block overflow-x-auto rounded-xl bg-field px-3 py-2 font-mono text-xs text-text">{command}</code>
              <button
                className={`${buttonBase} mt-3 border border-accent-border text-accent hover:bg-accent-soft`}
                type="button"
                onClick={() => void copyCommand()}
              >
                Copy command
              </button>
            </div>
          ) : (
            <p className="rounded-2xl border border-ok-border bg-ok-bg px-4 py-3 text-sm text-ok-text">
              Desktop/local indexing is available for this folder path.
            </p>
          )}

          {message ? <p className={statusClass(status)} aria-live="polite">{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function gateTitle(runtime: IndexFolderRuntime): string {
  if (runtime.localApi) return 'Use the CLI command below from this local browser session';
  return 'Available in the desktop app or CLI';
}

function gateCopy(runtime: IndexFolderRuntime): string {
  if (runtime.localApi) return 'Browser tabs cannot launch local folder reads directly; use the CLI command below.';
  return 'Available in the desktop app or CLI.';
}

function statusClass(status: Status): string {
  const tone = status === 'error' ? 'border-err-border bg-err-bg text-err-text' : 'border-ok-border bg-ok-bg text-ok-text';
  return `rounded-2xl border px-4 py-3 text-sm ${tone}`;
}
