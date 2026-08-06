import { Link } from 'react-router-dom';
import type { RouteMeta } from '../routeMeta';

function BreadcrumbLink({ label, to }: { label: string; to?: string }) {
  if (!to) return <span className="text-text-muted" aria-current="page">{label}</span>;
  return <Link className="focus-ring rounded-md text-text-muted transition hover:text-accent" to={to}>{label}</Link>;
}

export function PageChrome({ meta }: { meta: RouteMeta }) {
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
        <ol className="flex flex-wrap items-center gap-2">
          {meta.breadcrumbs.map((crumb, index) => (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true" className="text-text">/</span> : null}
              <BreadcrumbLink label={crumb.label} to={crumb.to} />
            </li>
          ))}
        </ol>
      </nav>
      <p className="text-sm font-medium uppercase tracking-[0.28em] text-accent">{meta.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-text sm:text-5xl">{meta.title}</h1>
      <p className="mt-3 max-w-2xl text-text-muted">{meta.description}</p>
    </div>
  );
}
