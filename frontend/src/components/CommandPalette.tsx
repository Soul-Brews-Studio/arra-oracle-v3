import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { StateNotice } from './StateNotice';

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
    { id: 'memory', label: 'Memory Dashboard', description: 'Review memory health heat-score, confidence, provenance, valid-time, and recency signals.', href: '/memory' },
    { id: 'metrics', label: 'Metrics', description: 'Review dashboard metrics and counts.', href: '/metrics' },
    { id: 'settings', label: 'Settings', description: 'Inspect runtime settings and migration status.', href: '/settings' },
    { id: 'refresh', label: 'Refresh dashboard data', description: 'Reload menu and plugin data.', onAction: onRefresh },
  ];
}

export function filterCommandPaletteActions(commands: CommandPaletteAction[], query: string): CommandPaletteAction[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(normalized));
}

export function CommandPalette({
  onRefresh,
  defaultOpen = false,
  initialQuery = '',
}: {
  onRefresh: () => void;
  defaultOpen?: boolean;
  initialQuery?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const commands = useMemo<CommandPaletteAction[]>(() => commandPaletteActions(onRefresh), [onRefresh]);
  const visibleCommands = useMemo(() => filterCommandPaletteActions(commands, query), [commands, query]);
  const listboxId = 'command-palette-options';
  const activeOptionId = visibleCommands[selectedIndex] ? `command-palette-option-${visibleCommands[selectedIndex].id}` : undefined;

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
      if (usesModifier && event.key.toLowerCase() === 'k' && !isTextInput(target) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (open && event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown as unknown as globalThis.EventListener);
    return () => window.removeEventListener('keydown', onKeyDown as unknown as globalThis.EventListener);
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (restoredRef.current) buttonRef.current?.focus();
      return;
    }
    restoredRef.current = true;
    setQuery('');
    setSelectedIndex(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= visibleCommands.length) setSelectedIndex(Math.max(visibleCommands.length - 1, 0));
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

  const overlay = open ? (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-surface/85 p-3 pt-20 backdrop-blur sm:items-center sm:pt-3"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <section
        id="command-palette-dialog"
        ref={overlayRef}
        className="glass max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-xl overflow-hidden rounded-2xl border border-[oklch(1_0_0/0.10)] bg-[oklch(0.16_0.02_265/0.72)] p-4 text-[oklch(0.98_0.01_257)] shadow-[0_24px_80px_oklch(0_0_0/0.45)] backdrop-blur-2xl transition-all duration-200"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        aria-describedby="command-palette-description"
      >
        <div className="mb-3">
          <h2 id="command-palette-title" className="text-sm font-semibold text-[oklch(0.98_0.01_257)]">Command palette</h2>
          <p id="command-palette-description" className="text-xs text-[oklch(0.82_0.04_257)]">Search pages and dashboard actions, then use Enter to run the selected item.</p>
        </div>
        <input
          ref={inputRef}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label="Search command palette"
          className="focus-ring mb-3 min-w-0 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text placeholder:text-text-muted"
          role="combobox"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleListKeyDown}
          placeholder="Search pages and actions…"
          type="search"
        />

        <ul id={listboxId} className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1" role="listbox" aria-label="Commands">
          {visibleCommands.map((command, index) => {
            const selected = index === selectedIndex;
            const optionId = `command-palette-option-${command.id}`;
            const optionClass = `focus-ring grid w-full gap-1 rounded-xl border border-border bg-surface p-3 text-left transition sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1.3fr)] ${selected ? 'border-accent-border bg-accent-soft' : 'hover:bg-surface-muted'}`;
            const label = <><span className="font-semibold text-text">{command.label}</span><span className="text-xs text-text-muted">{command.description}</span></>;
            return (
              <li key={command.id}>
                {command.href ? (
                  <Link aria-selected={selected} className={optionClass} id={optionId} onMouseEnter={() => setSelectedIndex(index)} onClick={() => execute(command)} role="option" to={command.href}>{label}</Link>
                ) : (
                  <button type="button" className={optionClass} aria-selected={selected} id={optionId} onMouseEnter={() => setSelectedIndex(index)} onClick={() => execute(command)} role="option">{label}</button>
                )}
              </li>
            );
          })}
        </ul>
        {!visibleCommands.length ? (
          <div className="mt-3">
            <StateNotice tone="warning" title="No matching command actions." detail="Try menu, plugins, MCP, vector, settings, or refresh." />
          </div>
        ) : null}
      </section>
    </div>
  ) : null;

  return (
    <div>
      <button
        ref={buttonRef}
        aria-label="Open command palette"
        aria-controls="command-palette-dialog"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="focus-ring w-full rounded-xl border border-border bg-field px-4 py-3 text-left text-sm text-text transition hover:border-accent-border hover:bg-surface-muted"
        type="button"
        onClick={() => setOpen(true)}
      >
        Search actions (⌘K)
      </button>

      {overlay && (typeof document === 'undefined' ? overlay : createPortal(overlay, document.body))}
    </div>
  );
}
