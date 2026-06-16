import { GlobalSearch } from '../components/GlobalSearch';

export function SearchPage() {
  return (
    <section className="grid gap-5" aria-labelledby="search-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Search</p>
      <h2 id="search-page-title" className="text-2xl font-semibold text-white">Search surfaces</h2>
      <p className="text-sm text-slate-400">Search menu, plugins, and MCP tool surfaces.</p>
      <GlobalSearch />
    </section>
  );
}
