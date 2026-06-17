import type { ReactNode } from 'react';

export interface ExportHelpProps {
  backendUrl?: string;
  command?: string;
}

const formats = [
  { name: 'JSON', detail: 'Structured records for automation and restore tooling.' },
  { name: 'JSONL', detail: 'Newline-delimited vector records for streaming large collections.' },
  { name: 'CSV', detail: 'Spreadsheet-friendly rows with stable columns where available.' },
  { name: 'MD', detail: 'Readable Markdown snapshots for vault handoffs.' },
];

const batchFiles = [
  'collections/<collection>.json',
  'collections/<collection>.csv',
  'collections/<collection>.md',
  'relationships.<ext>',
  'all-collections.json',
  'manifest.json',
];

const examples = [
  'maw arra export --format json --out vault-export.json',
  'maw arra export --format markdown --out vault.md',
  'maw arra export --source vector --collection bge-m3 --format jsonl --out bge-m3.jsonl',
  'bun run tools/export-app/index.ts --output ./backup/export-app --db ./oracle.db',
];

const recoverySteps = [
  'Run Test connection first; it verifies the backend URL and collection counts before any export starts.',
  'If an export fails, keep the same backend URL and payload, then use Retry before changing settings.',
  'Keep the generated manifest.json with each backup so migrations can confirm collection and graph coverage.',
];

function CodeLine({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto rounded-xl border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-text dark:border-border dark:bg-surface-muted dark:text-text">
      {children}
    </code>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-accent-border bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent dark:border-accent-border dark:bg-accent-soft dark:text-accent">
      {children}
    </span>
  );
}

function HelpBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-muted p-4 dark:border-border dark:bg-surface-muted" aria-label={title}>
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-text-muted">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ExportHelp({
  backendUrl = 'http://localhost:47778',
  command = 'maw arra export',
}: ExportHelpProps) {
  return (
    <aside className="rounded-3xl border border-border bg-surface p-5 shadow-sm dark:border-border dark:bg-surface sm:p-6" aria-labelledby="export-help-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Export help</p>
        <h2 id="export-help-title" className="mt-2 text-2xl font-semibold text-on-accent dark:text-text">Export app guide</h2>
        <p className="mt-2 text-sm text-text-muted dark:text-text-muted">
          Export local database snapshots, vector collections, and graph relationships for review or transfer.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <HelpBlock title="Backend">
          <div className="grid gap-2 text-sm text-text dark:text-text-muted">
            <p>Use <span className="font-mono text-text dark:text-text">ORACLE_API</span> for backend-connected UI and API commands.</p>
            <CodeLine>{`export ORACLE_API=${backendUrl}`}</CodeLine>
            <CodeLine>{`https://studio.buildwithoracle.com/?api=${backendUrl}`}</CodeLine>
          </div>
        </HelpBlock>

        <HelpBlock title="Formats">
          <dl className="grid gap-3">
            {formats.map((format) => (
              <div key={format.name} className="grid gap-1">
                <dt><Badge>{format.name}</Badge></dt>
                <dd className="text-sm text-text-muted dark:text-text-muted">{format.detail}</dd>
              </div>
            ))}
          </dl>
        </HelpBlock>

        <HelpBlock title="Graph">
          <div className="grid gap-2 text-sm text-text dark:text-text-muted">
            <p>Full exports include relationship edges from supersession, supersede logs, and trace links.</p>
            <p className="font-mono text-xs text-text-muted">{'{ type, from, to, metadata? }'}</p>
          </div>
        </HelpBlock>

        <HelpBlock title="Batch mode">
          <ul className="grid gap-2 text-sm text-text dark:text-text-muted">
            {batchFiles.map((file) => <li key={file} className="font-mono text-xs">{file}</li>)}
          </ul>
        </HelpBlock>

        <HelpBlock title="Recovery & retry">
          <ol className="grid gap-2 text-sm text-text-muted">
            {recoverySteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </HelpBlock>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface-muted p-4 dark:border-border dark:bg-surface-muted">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-text-muted">CLI</h3>
        <p className="mt-2 text-sm text-text-muted dark:text-text-muted">
          Use <span className="font-mono text-text dark:text-text">{command}</span> for one-off exports or the batch app for full snapshots.
        </p>
        <div className="mt-3 grid gap-2">
          {examples.map((example) => <CodeLine key={example}>{example}</CodeLine>)}
        </div>
      </div>
    </aside>
  );
}
