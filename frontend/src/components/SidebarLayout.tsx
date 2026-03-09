import { Link, useLocation } from 'react-router-dom';
import styles from './SidebarLayout.module.css';

const DEFAULT_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'principle', label: 'Principles' },
  { key: 'learning', label: 'Learnings' },
  { key: 'retro', label: 'Retros' }
];

interface FilterItem {
  key: string;
  label: string;
}

interface NavItem {
  path: string;
  label: string;
}

interface SidebarLayoutProps {
  children: React.ReactNode;
  activeType?: string;
  onTypeChange?: (type: string) => void;
  filters?: FilterItem[];
  filterTitle?: string;
  linkBase?: string;
  navItems?: NavItem[];
  navTitle?: string;
}

export const TOOLS_NAV: NavItem[] = [
  { path: '/evolution', label: 'Evolution' },
  { path: '/traces', label: 'Traces' },
  { path: '/superseded', label: 'Superseded' },
  { path: '/handoff', label: 'Handoff' },
];

export function SidebarLayout({
  children,
  activeType = 'all',
  onTypeChange,
  filters = DEFAULT_TYPES,
  filterTitle = 'Filter by Type',
  linkBase = '/feed',
  navItems,
  navTitle = 'Navigate',
}: SidebarLayoutProps) {
  const location = useLocation();

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        {navItems && navItems.length > 0 && (
          <>
            <h3 className={styles.sidebarTitle}>{navTitle}</h3>
            <div className={styles.navLinks}>
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`${styles.navLink} ${location.pathname === item.path ? styles.navActive : ''}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </>
        )}
        {filters.length > 0 && (
          <>
            <h3 className={styles.sidebarTitle}>{filterTitle}</h3>
            <div className={styles.filters}>
              {filters.map(t => (
                onTypeChange ? (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => onTypeChange(t.key)}
                    className={`${styles.filterBtn} ${activeType === t.key ? styles.active : ''}`}
                  >
                    {t.label}
                  </button>
                ) : (
                  <Link
                    key={t.key}
                    to={t.key === 'all' ? linkBase : `${linkBase}?type=${t.key}`}
                    className={`${styles.filterBtn} ${activeType === t.key ? styles.active : ''}`}
                  >
                    {t.label}
                  </Link>
                )
              ))}
            </div>
          </>
        )}
      </aside>
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
