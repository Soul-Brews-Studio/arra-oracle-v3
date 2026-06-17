import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export type CommandPaletteAction = {
  id: string;
  label: string;
  description: string;
  href?: string;
  onAction?: () => void;
};

export function commandPaletteActions(onRefresh: () => void): CommandPaletteAction[] {
  return [
    { id: 'menu', label: 'Menu catalog', description: 'Review /api/menu rows and plugin menu sources.', href: '/menu' },
    { id: 'search', label: 'Search', description: 'Open unified surface search.', href: '/search' },
    { id: 'plugins', label: 'Plugins', description: 'Review plugins and runtime surfaces.', href: '/plugins' },
    { id: 'mcp', label: 'MCP tools', description: 'Browse MCP-out tool schemas and plugin source labels.', href: '/mcp' },
    { id: 'status', label: 'Status', description: 'Review server health from /api/v1/health.', href: '/status' },
    { id: 'storage', label: 'Storage backend', description: 'Inspect backend config from /api/settings/system.', href: '/storage' },
    { id: 'vector', label: 'Vector', description: 'Open vector search and indexing surfaces.', href: '/vector' },
    { id: 'metrics', label: 'Metrics', description: 'Review dashboard metrics and counts.', href: '/metrics' },
    { id: 'settings', label: 'Settings', description: 'Inspect runtime settings and migration status.', href: '/settings' },
    { id: 'refresh', label: 'Refresh dashboard data', description: 'Reload menu and plugin data.', onAction: onRefresh },
  ];
}

export function CommandPalette({ onRefresh }: { onRefresh: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<CommandPaletteAction[]>(() => commandPaletteActions(onRefresh), [onRefresh]);

  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => {
      const searchable = `${command.label} ${command.description}`.toLowerCase();
      return searchable.includes(normalized);
    });
  }, [commands, query]);

  useEffect(() => {
    const isTextInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest('[contenteditable="true"]')) return true;
      const tag = target.tagName.toLowerCase();
      return tag === 'textarea' || tag === 'input';
    };

    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as EventTarget | null;
      const usesModifier = event.metaKey || event.ctrlKey;
      const isK = event.key.toLowerCase() === 'k';

      if (usesModifier && isK && !isTextInput(target) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown as unknown as globalThis.EventListener);
    return () => window.removeEventListener('keydown', onKeyDown as unknown as globalThis.EventListener);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= visibleCommands.length) {
      setSelectedIndex(Math.max(visibleCommands.length - 1, 0));
    }
  }, [selectedIndex, visibleCommands.length]);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      if (overlayRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  function execute(command: CommandPaletteAction) {
    if (command.onAction) command.onAction();
    if (command.href) navigate(command.href);
    setOpen(false);
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1) % Math.max(visibleCommands.length, 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => (current - 1 + Math.max(visibleCommands.length, 1)) % Math.max(visibleCommands.length, 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const current = visibleCommands[selectedIndex];
      if (current) execute(current);
    }
  }

  return (
    <div>
      <button
        aria-label="Open command palette"
        className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-left text-sm text-text transition hover:bg-field dark:border-border dark:bg-surface-muted dark:text-text dark:hover:border-accent-border"
        type="button"
        onClick={() => setOpen(true)}
      >
        Search actions (⌘K)
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-surface p-3"
          aria-label="Command palette modal"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <section
            ref={overlayRef}
            className="w-full max-w-xl rounded-2xl border border-border bg-field p-4 shadow-2xl shadow-slate-900/20 dark:border-border dark:bg-field"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <input
              ref={inputRef}
              aria-label="Search command palette"
              className="focus-ring mb-3 min-w-0 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-on-accent dark:border-border dark:bg-surface-muted dark:text-text"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleListKeyDown}
              placeholder="Search pages and actions…"
              type="search"
            />

            <ul className="grid gap-2" role="listbox" aria-label="Commands">
              {visibleCommands.map((command, index) => {
                const selected = index === selectedIndex;
                return (
                  <li key={command.id}>
                    {command.href ? (
                      <Link
                        aria-selected={selected}
                        className={`focus-ring flex w-full items-start justify-between rounded-xl border border-border bg-surface p-3 text-left transition ${selected ? 'border-accent-border bg-accent-soft' : 'hover:bg-field'}`}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => execute(command)}
                        to={command.href}
                      >
                        <span className="font-semibold text-text dark:text-text">{command.label}</span>
                        <span className="text-xs text-text-muted dark:text-text-muted">{command.description}</span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={`focus-ring flex w-full items-start justify-between rounded-xl border border-border bg-surface p-3 text-left transition ${selected ? 'border-accent-border bg-accent-soft' : 'hover:bg-field'}`}
                        aria-selected={selected}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => execute(command)}
                      >
                        <span className="font-semibold text-text dark:text-text">{command.label}</span>
                        <span className="text-xs text-text-muted dark:text-text-muted">{command.description}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
