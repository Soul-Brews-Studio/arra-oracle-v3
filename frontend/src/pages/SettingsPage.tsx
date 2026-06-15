type SettingsPageProps = {
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  updatedAt: string;
  onRefresh: () => void;
};

function SettingCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</dt>
      <dd className="mt-2 font-mono text-sm text-teal-200">{value}</dd>
      <dd className="mt-2 text-sm leading-6 text-slate-400">{detail}</dd>
    </div>
  );
}

export function SettingsPage({ menuCount, pluginCount, surfaceCount, updatedAt, onRefresh }: SettingsPageProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="settings-page-title">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Settings</p>
          <h2 id="settings-page-title" className="mt-2 text-2xl font-semibold text-white">Frontend runtime</h2>
          <p className="mt-2 text-sm text-slate-400">Read-only implementation notes for this routed control surface.</p>
        </div>
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" type="button" onClick={onRefresh}>
          Refresh backend data
        </button>
      </div>

      <dl className="grid gap-4 md:grid-cols-2">
        <SettingCard label="API proxy" value="/api/* → :47778" detail="Vite forwards same-origin frontend API calls to the Elysia backend during local development." />
        <SettingCard label="Routes" value="/menu /plugins /vector /mcp /settings" detail="React Router owns client-side navigation while backend endpoints stay canonical." />
        <SettingCard label="Loaded rows" value={`${menuCount} menu · ${pluginCount} plugins`} detail={`Last refreshed ${updatedAt}; use refresh after backend changes.`} />
        <SettingCard label="Plugin surfaces" value={surfaceCount} detail="Counts wasm, menu, server, and MCP surfaces exposed by registered plugin metadata." />
      </dl>
    </section>
  );
}
