import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SidebarLayout } from '../components/SidebarLayout';
import { TraceDetailView } from '../components/TraceDetailView';
import styles from './Traces.module.css';

interface TraceSummary {
  traceId: string;
  query: string;
  depth: number;
  fileCount: number;
  commitCount: number;
  issueCount: number;
  status: 'raw' | 'reviewed' | 'distilled';
  hasAwakening: boolean;
  createdAt: number;
  parentTraceId?: string | null;
  prevTraceId?: string | null;
  nextTraceId?: string | null;
}

interface TraceDetail {
  traceId: string;
  query: string;
  queryType: string;
  project: string | null;
  foundFiles: Array<{ path: string; type?: string; confidence?: string; matchReason?: string }>;
  foundCommits: Array<{ hash: string; shortHash?: string; message: string; date?: string }>;
  foundIssues: Array<{ number: number; title: string; state?: string; url?: string }>;
  foundRetrospectives: string[];
  foundLearnings: string[];
  fileCount: number;
  commitCount: number;
  issueCount: number;
  depth: number;
  parentTraceId: string | null;
  childTraceIds: string[];
  prevTraceId: string | null;
  nextTraceId: string | null;
  status: string;
  awakening: string | null;
  createdAt: number;
}

interface TracesResponse {
  traces: TraceSummary[];
  total: number;
  hasMore: boolean;
}

const TRACE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'raw', label: 'Raw' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'distilled', label: 'Distilled' },
];

function getStatusBadge(status: string, hasAwakening: boolean) {
  if (hasAwakening) return <span className={styles.badgeAwakening}>awakened</span>;
  switch (status) {
    case 'distilled': return <span className={styles.badgeDistilled}>distilled</span>;
    case 'reviewed': return <span className={styles.badgeReviewed}>reviewed</span>;
    default: return <span className={styles.badgeRaw}>raw</span>;
  }
}

function getDigPointsPreview(t: TraceSummary) {
  const parts: string[] = [];
  if (t.fileCount > 0) parts.push(`${t.fileCount} files`);
  if (t.commitCount > 0) parts.push(`${t.commitCount} commits`);
  if (t.issueCount > 0) parts.push(`${t.issueCount} issues`);
  return parts.length > 0 ? parts.join(' · ') : 'no dig points';
}

export function Traces() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [linkedChain, setLinkedChain] = useState<TraceDetail[]>([]);
  const [chainPosition, setChainPosition] = useState(0);
  const [familyChain, setFamilyChain] = useState<TraceDetail[]>([]);
  const [familyPosition, setFamilyPosition] = useState(0);

  useEffect(() => {
    if (id) {
      loadTraceDetail(id);
      const inCurrentChain = linkedChain.some(t => t.traceId === id);
      if (!inCurrentChain) {
        loadLinkedChain(id);
      } else {
        const newPosition = linkedChain.findIndex(t => t.traceId === id);
        if (newPosition !== -1) setChainPosition(newPosition);
      }
      const inFamilyChain = familyChain.some(t => t.traceId === id);
      if (!inFamilyChain) {
        loadFamilyChain(id);
      } else {
        const newFamilyPos = familyChain.findIndex(t => t.traceId === id);
        if (newFamilyPos !== -1) setFamilyPosition(newFamilyPos);
      }
    } else {
      loadTraces();
      setLinkedChain([]);
      setFamilyChain([]);
    }
  }, [id, statusFilter]);

  async function loadTraces() {
    setLoading(true);
    setSelectedTrace(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/traces?${params}`);
      const data: TracesResponse = await res.json();
      setTraces(data.traces);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load traces:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadTraceDetail(traceId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/traces/${traceId}`);
      if (!res.ok) { navigate('/traces'); return; }
      const data: TraceDetail = await res.json();
      setSelectedTrace(data);
    } catch (err) {
      console.error('Failed to load trace detail:', err);
      navigate('/traces');
    } finally {
      setLoading(false);
    }
  }

  async function loadLinkedChain(traceId: string) {
    try {
      const res = await fetch(`/api/traces/${traceId}/linked-chain`);
      if (res.ok) {
        const data = await res.json();
        setLinkedChain(data.chain || []);
        setChainPosition(data.position || 0);
      }
    } catch (err) {
      console.error('Failed to load linked chain:', err);
      setLinkedChain([]);
    }
  }

  async function loadFamilyChain(traceId: string) {
    try {
      const res = await fetch(`/api/traces/${traceId}`);
      if (!res.ok) return;
      const current: TraceDetail = await res.json();
      const family: TraceDetail[] = [];

      if (current.parentTraceId) {
        const parentRes = await fetch(`/api/traces/${current.parentTraceId}`);
        if (parentRes.ok) family.push(await parentRes.json());
      }
      family.push(current);
      if (current.childTraceIds && current.childTraceIds.length > 0) {
        for (const childId of current.childTraceIds) {
          const childRes = await fetch(`/api/traces/${childId}`);
          if (childRes.ok) family.push(await childRes.json());
        }
      }
      if (current.parentTraceId) {
        const parentRes = await fetch(`/api/traces/${current.parentTraceId}`);
        if (parentRes.ok) {
          const parent: TraceDetail = await parentRes.json();
          for (const siblingId of parent.childTraceIds || []) {
            if (siblingId !== traceId && !family.some(f => f.traceId === siblingId)) {
              const sibRes = await fetch(`/api/traces/${siblingId}`);
              if (sibRes.ok) family.push(await sibRes.json());
            }
          }
        }
      }

      family.sort((a, b) => a.createdAt - b.createdAt);
      const finalPosition = family.findIndex(f => f.traceId === traceId);
      setFamilyChain(family);
      setFamilyPosition(finalPosition >= 0 ? finalPosition : 0);
    } catch (err) {
      console.error('Failed to load family chain:', err);
      setFamilyChain([]);
    }
  }

  // Detail view (delegated to TraceDetailView component)
  if (selectedTrace) {
    return (
      <TraceDetailView
        trace={selectedTrace}
        linkedChain={linkedChain}
        chainPosition={chainPosition}
        familyChain={familyChain}
        familyPosition={familyPosition}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        traceFilters={TRACE_FILTERS}
      />
    );
  }

  // Group traces by date
  const grouped = traces.reduce((acc, t) => {
    const date = new Date(t.createdAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(t);
    return acc;
  }, {} as Record<string, TraceSummary[]>);

  // List view
  return (
    <SidebarLayout
      filters={TRACE_FILTERS}
      filterTitle="Filter by Status"
      activeType={statusFilter}
      onTypeChange={setStatusFilter}
    >
      <h1 className={styles.title}>Discovery Traces</h1>
      <p className={styles.subtitle}>
        Your discovery journeys — what you searched and found
        <span className={styles.philosophy}>"Trace → Dig → Distill → Awakening"</span>
      </p>

      {loading ? (
        <div className={styles.loading}>Loading traces...</div>
      ) : traces.length === 0 ? (
        <div className={styles.empty}>
          <p>No traces recorded yet.</p>
          <p className={styles.hint}>Use <code>/trace</code> or <code>oracle_trace()</code> to log discoveries.</p>
        </div>
      ) : (
        <>
          <div className={styles.stats}>
            <span>{total} trace{total !== 1 ? 's' : ''} logged</span>
          </div>

          <div className={styles.timeline}>
            {Object.entries(grouped).map(([date, items]) => {
              const roots = items.filter(t => t.depth === 0 || !t.parentTraceId);
              const children = items.filter(t => t.depth > 0 && t.parentTraceId);
              const tree = roots.map(root => ({
                root,
                children: children.filter(c => c.parentTraceId === root.traceId)
              }));
              const assignedChildren = new Set(tree.flatMap(t => t.children.map(c => c.traceId)));
              const orphans = children.filter(c => !assignedChildren.has(c.traceId));

              return (
                <div key={date} className={styles.dateGroup}>
                  <h2 className={styles.date}>{date}</h2>
                  <div className={styles.items}>
                    {tree.map(({ root, children }) => (
                      <div key={root.traceId} className={styles.traceFamily}>
                        <div className={styles.item} onClick={() => navigate(`/traces/${root.traceId}`)}>
                          <div className={styles.itemHeader}>
                            <span className={styles.queryText}>"{root.query}"</span>
                            {getStatusBadge(root.status, root.hasAwakening)}
                          </div>
                          <div className={styles.itemDigPoints}>{getDigPointsPreview(root)}</div>
                          <div className={styles.itemMeta}>
                            <code className={styles.traceId}>{root.traceId.slice(0, 8)}</code>
                            {(root.prevTraceId || root.nextTraceId) && (
                              <span className={styles.linkStatus}>
                                {root.prevTraceId && '←'}
                                {root.prevTraceId && root.nextTraceId ? ' linked ' : root.prevTraceId ? ' first' : ''}
                                {root.nextTraceId && '→'}
                                {!root.nextTraceId && root.prevTraceId && ' last'}
                              </span>
                            )}
                            <span className={styles.time}>
                              {new Date(root.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        {children.length > 0 && (
                          <div className={styles.childTraces}>
                            {children.map(child => (
                              <div key={child.traceId} className={`${styles.item} ${styles.childItem}`} onClick={() => navigate(`/traces/${child.traceId}`)}>
                                <div className={styles.itemHeader}>
                                  <span className={styles.childIndicator}>↳</span>
                                  <span className={styles.queryText}>"{child.query}"</span>
                                  {getStatusBadge(child.status, child.hasAwakening)}
                                </div>
                                <div className={styles.itemDigPoints}>{getDigPointsPreview(child)}</div>
                                <div className={styles.itemMeta}>
                                  <code className={styles.traceId}>{child.traceId.slice(0, 8)}</code>
                                  <span className={styles.depth}>depth {child.depth}</span>
                                  {(child.prevTraceId || child.nextTraceId) && (
                                    <span className={styles.linkStatus}>
                                      {child.prevTraceId && '←'}
                                      {child.nextTraceId && '→'}
                                      {!child.nextTraceId && child.prevTraceId && ' last'}
                                    </span>
                                  )}
                                  <span className={styles.time}>
                                    {new Date(child.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {orphans.map(orphan => (
                      <div key={orphan.traceId} className={`${styles.item} ${styles.childItem}`} onClick={() => navigate(`/traces/${orphan.traceId}`)}>
                        <div className={styles.itemHeader}>
                          <span className={styles.childIndicator}>↳</span>
                          <span className={styles.queryText}>"{orphan.query}"</span>
                          {getStatusBadge(orphan.status, orphan.hasAwakening)}
                        </div>
                        <div className={styles.itemDigPoints}>{getDigPointsPreview(orphan)}</div>
                        <div className={styles.itemMeta}>
                          <span className={styles.depth}>depth {orphan.depth}</span>
                          <span className={styles.time}>
                            {new Date(orphan.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </SidebarLayout>
  );
}
