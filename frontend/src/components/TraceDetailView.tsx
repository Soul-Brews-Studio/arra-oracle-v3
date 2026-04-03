import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarLayout, TOOLS_NAV } from './SidebarLayout';
import { getDocDisplayInfo } from '../utils/docDisplay';
import styles from '../pages/Traces.module.css';

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

interface TraceDetailViewProps {
  trace: TraceDetail;
  linkedChain: TraceDetail[];
  chainPosition: number;
  familyChain: TraceDetail[];
  familyPosition: number;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  traceFilters: Array<{ key: string; label: string }>;
}

function getStatusBadge(status: string, hasAwakening: boolean) {
  if (hasAwakening) return <span className={styles.badgeAwakening}>awakened</span>;
  switch (status) {
    case 'distilled': return <span className={styles.badgeDistilled}>distilled</span>;
    case 'reviewed': return <span className={styles.badgeReviewed}>reviewed</span>;
    default: return <span className={styles.badgeRaw}>raw</span>;
  }
}

export function TraceDetailView({
  trace: t,
  linkedChain,
  chainPosition,
  familyChain,
  familyPosition,
  statusFilter,
  onStatusFilterChange,
  traceFilters,
}: TraceDetailViewProps) {
  const navigate = useNavigate();
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileGithubUrl, setFileGithubUrl] = useState<string | null>(null);
  const [fileConcepts, setFileConcepts] = useState<string[]>([]);
  const [fileProject, setFileProject] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  async function toggleFilePreview(path: string, project: string | null) {
    if (expandedFile === path) {
      setExpandedFile(null);
      setFileContent(null);
      setFileGithubUrl(null);
      setFileConcepts([]);
      setFileProject(null);
      return;
    }

    setExpandedFile(path);
    setFileContent(null);
    setFileGithubUrl(null);
    setFileConcepts([]);
    setFileProject(project);
    setLoadingFile(true);

    let ghUrl: string | null = null;
    if (project) {
      const isRepoRef = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(path);
      if (isRepoRef) {
        ghUrl = `https://github.com/${path}`;
      } else {
        const ghProject = project.includes('github.com') ? project : `github.com/${project}`;
        ghUrl = `https://${ghProject}/blob/main/${path}`;
      }
      setFileGithubUrl(ghUrl);
    }

    try {
      const params = new URLSearchParams({ path });
      if (project) params.set('project', project);
      const res = await fetch(`/api/file?${params}`);
      if (res.ok) {
        const text = await res.text();
        if (text && !text.startsWith('File not found')) {
          setFileContent(text);
          return;
        }
      }

      const searchTerm = path.split('/').pop()?.replace('.md', '') || path.split('/').slice(-1)[0] || '';
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}&limit=1`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results?.[0]) {
          if (searchData.results[0].content) setFileContent(searchData.results[0].content);
          if (searchData.results[0].concepts) setFileConcepts(searchData.results[0].concepts);
          return;
        }
      }

      if (!fileConcepts.length) {
        const repoName = path.replace(/\//g, ' ');
        const repoSearchRes = await fetch(`/api/search?q=${encodeURIComponent(repoName)}&limit=1`);
        if (repoSearchRes.ok) {
          const repoData = await repoSearchRes.json();
          if (repoData.results?.[0]?.concepts) setFileConcepts(repoData.results[0].concepts);
        }
      }

      setFileContent(null);
    } catch {
      setFileContent('Failed to load file');
    } finally {
      setLoadingFile(false);
    }
  }

  const totalDigPoints = t.fileCount + t.commitCount + t.issueCount +
    t.foundRetrospectives.length + t.foundLearnings.length;

  return (
    <SidebarLayout
      navItems={TOOLS_NAV}
      navTitle="Tools"
      filters={traceFilters}
      filterTitle="Filter by Status"
      activeType={statusFilter}
      onTypeChange={onStatusFilterChange}
    >
      <div className={styles.navBar}>
        <button onClick={() => navigate('/traces')} className={styles.backLink}>
          ← Back to Traces
        </button>
        <div className={styles.chainNav}>
          {(() => {
            const chain = linkedChain.length > 1 ? linkedChain : familyChain;
            const position = linkedChain.length > 1 ? chainPosition : familyPosition;
            if (chain.length <= 1) return null;
            return (
              <>
                {position > 0 ? (
                  <button onClick={() => navigate(`/traces/${chain[0].traceId}`)} className={styles.navButton} title="First">⏮</button>
                ) : (<span className={styles.navDisabled}>⏮</span>)}
                {position > 0 ? (
                  <button onClick={() => navigate(`/traces/${chain[position - 1].traceId}`)} className={styles.navButton} title="Previous">←</button>
                ) : (<span className={styles.navDisabled}>←</span>)}
                <div className={styles.chainNumbers}>
                  {chain.map((trace, i) => (
                    <button key={trace.traceId} onClick={() => navigate(`/traces/${trace.traceId}`)} className={`${styles.chainNumber} ${i === position ? styles.currentNumber : ''}`} title={trace.query}>
                      {i + 1}
                    </button>
                  ))}
                </div>
                {position < chain.length - 1 ? (
                  <button onClick={() => navigate(`/traces/${chain[position + 1].traceId}`)} className={styles.navButton} title="Next">→</button>
                ) : (<span className={styles.navDisabled}>→</span>)}
                {position < chain.length - 1 ? (
                  <button onClick={() => navigate(`/traces/${chain[chain.length - 1].traceId}`)} className={styles.navButton} title="Last">⏭</button>
                ) : (<span className={styles.navDisabled}>⏭</span>)}
              </>
            );
          })()}
        </div>
      </div>

      <div className={styles.detailHeader}>
        <h1 className={styles.query}>"{t.query}"</h1>
        <div className={styles.detailMeta}>
          {getStatusBadge(t.status, !!t.awakening)}
          <span className={styles.queryType}>{t.queryType}</span>
          {(() => {
            const tInfo = getDocDisplayInfo('', t.project);
            return tInfo.projectVaultUrl ? (
              <a href={tInfo.projectVaultUrl} target="_blank" rel="noopener noreferrer" className={styles.projectLink} onClick={e => e.stopPropagation()}>
                🔗 {tInfo.projectDisplay}
              </a>
            ) : (
              <span className={styles.universalBadge}>✦ universal</span>
            );
          })()}
          <span className={styles.timestamp}>{new Date(t.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {t.awakening && (
        <div className={styles.awakening}><h3>Awakening</h3><p>{t.awakening}</p></div>
      )}

      <div className={styles.digPointsSummary}>
        <span>{totalDigPoints} dig points found</span>
        {t.depth > 0 && <span className={styles.depth}>depth: {t.depth}</span>}
      </div>

      <div className={styles.digPoints}>
        {t.foundFiles.length > 0 && (
          <section className={styles.section}>
            <h3>Files ({t.foundFiles.length})</h3>
            <ul className={styles.fileList}>
              {t.foundFiles.map((f, i) => (
                <li key={i} className={styles.fileEntry}>
                  <div className={`${styles.fileItem} ${expandedFile === f.path ? styles.expanded : ''}`} onClick={() => toggleFilePreview(f.path, t.project)}>
                    <span className={styles.filePath}>{f.path}</span>
                    {f.confidence && <span className={styles.confidence}>{f.confidence}</span>}
                    {f.matchReason && <span className={styles.matchReason}>{f.matchReason}</span>}
                  </div>
                  {expandedFile === f.path && (
                    <div className={styles.filePreview}>
                      {loadingFile ? (<div className={styles.previewLoading}>Loading...</div>) : (
                        <>
                          {(fileGithubUrl || t.project) && (
                            <div className={styles.githubLink}>
                              {fileGithubUrl && (<a href={fileGithubUrl} target="_blank" rel="noopener noreferrer" className={styles.viewOnGithub}>View on GitHub →</a>)}
                              {(() => {
                                const sourceFile = t.project ? `${t.project.includes('github.com') ? '' : 'github.com/'}${t.project}/${f.path}` : f.path;
                                const fInfo = getDocDisplayInfo(sourceFile, t.project);
                                return fInfo.vaultUrl ? (<a href={fInfo.vaultUrl} target="_blank" rel="noopener noreferrer" className={styles.vaultBadge}>🏛️ vault</a>) : null;
                              })()}
                            </div>
                          )}
                          {fileConcepts.length > 0 && (
                            <div className={styles.conceptsBar}>
                              <span className={styles.conceptLabel}>Related:</span>
                              {fileConcepts.map((c, j) => (<span key={j} className={styles.conceptBadge}>{c}</span>))}
                            </div>
                          )}
                          {fileContent ? (<pre className={styles.previewContent}>{fileContent}</pre>) : (
                            <div className={styles.notFoundLocal}>
                              ⚠️ local file not found
                              {fileProject && (<div className={styles.projectSource}>📦 Source: {fileProject}</div>)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.foundCommits.length > 0 && (
          <section className={styles.section}>
            <h3>Commits ({t.foundCommits.length})</h3>
            {t.project && <div className={styles.commitRepo}>{t.project}</div>}
            <ul className={styles.commitList}>
              {t.foundCommits.map((c, i) => {
                const repoMatch = c.message.match(/^([a-zA-Z0-9_-]+):\s/);
                const org = t.project?.split('/')[0] || 'LarisLabs';
                let targetProject = t.project;
                if (repoMatch) targetProject = `${org}/${repoMatch[1]}`;
                const ghProject = targetProject?.includes('github.com') ? targetProject : `github.com/${targetProject}`;
                const commitUrl = targetProject ? `https://${ghProject}/commit/${c.hash}` : null;
                const displayHash = c.shortHash || c.hash.slice(0, 7);
                return (
                  <li key={i} className={styles.commitItem}>
                    {commitUrl ? (<a href={commitUrl} target="_blank" rel="noopener noreferrer" className={styles.commitHash}>{displayHash}</a>) : (<code className={styles.commitHash}>{displayHash}</code>)}
                    <span className={styles.commitMessage}>{c.message}</span>
                    {c.date && <span className={styles.commitDate}>{c.date}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {t.foundIssues.length > 0 && (
          <section className={styles.section}>
            <h3>Issues ({t.foundIssues.length})</h3>
            {t.project && <div className={styles.issueRepo}>{t.project}</div>}
            <ul className={styles.issueList}>
              {t.foundIssues.map((issue, i) => {
                const issueUrl = issue.url || (t.project ? `https://${t.project}/issues/${issue.number}` : null);
                return (
                  <li key={i} className={styles.issueItem}>
                    <span className={`${styles.issueState} ${issue.state === 'open' ? styles.open : styles.closed}`}>#{issue.number}</span>
                    {issueUrl ? (<a href={issueUrl} target="_blank" rel="noopener noreferrer" className={styles.issueTitle}>{issue.title}</a>) : (<span className={styles.issueTitle}>{issue.title}</span>)}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {t.foundRetrospectives.length > 0 && (
          <section className={styles.section}>
            <h3>Retrospectives ({t.foundRetrospectives.length})</h3>
            <ul className={styles.fileList}>
              {t.foundRetrospectives.map((path, i) => (
                <li key={i} className={styles.fileEntry}>
                  <div className={`${styles.fileItem} ${expandedFile === path ? styles.expanded : ''}`} onClick={() => toggleFilePreview(path, null)}>
                    <span className={styles.filePath}>{path}</span>
                  </div>
                  {expandedFile === path && (
                    <div className={styles.filePreview}>
                      {loadingFile ? (<div className={styles.previewLoading}>Loading...</div>) : (
                        <>{fileContent ? (<pre className={styles.previewContent}>{fileContent}</pre>) : (<div className={styles.notFoundLocal}>Retrospective not found</div>)}</>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.foundLearnings.length > 0 && (
          <section className={styles.section}>
            <h3>Learnings ({t.foundLearnings.length})</h3>
            <ul className={styles.fileList}>
              {t.foundLearnings.map((item, i) => {
                const isFilePath = item.startsWith('ψ/') || item.includes('/memory/');
                if (!isFilePath) return (<li key={i} className={styles.learningSnippet}>{item}</li>);
                return (
                  <li key={i} className={styles.fileEntry}>
                    <div className={`${styles.fileItem} ${expandedFile === item ? styles.expanded : ''}`} onClick={() => toggleFilePreview(item, t.project)}>
                      <span className={styles.filePath}>{item}</span>
                    </div>
                    {expandedFile === item && (
                      <div className={styles.filePreview}>
                        {loadingFile ? (<div className={styles.previewLoading}>Loading...</div>) : (
                          <>
                            {fileConcepts.length > 0 && (
                              <div className={styles.conceptsBar}>
                                <span className={styles.conceptLabel}>Related:</span>
                                {fileConcepts.map((c, j) => (<span key={j} className={styles.conceptBadge}>{c}</span>))}
                              </div>
                            )}
                            {fileContent ? (<pre className={styles.previewContent}>{fileContent}</pre>) : (
                              <div className={styles.notFoundLocal}>
                                ⚠️ local file not found
                                {fileProject && (<div className={styles.projectSource}>📦 Source: {fileProject}</div>)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {totalDigPoints === 0 && (
          <div className={styles.noDigPoints}>No dig points recorded for this trace.</div>
        )}
      </div>

      {/* Linked Traces - Full Content */}
      {linkedChain.filter(trace => trace.traceId !== t.traceId).map((trace) => (
        <div key={trace.traceId} className={styles.linkedTrace}>
          <div className={styles.linkedTraceHeader}>
            <button className={styles.linkedTraceLabel} onClick={() => navigate(`/traces/${trace.traceId}`)}>
              {trace.traceId === t.prevTraceId ? '← Previous' : 'Next →'}
            </button>
            <h2 className={styles.linkedTraceQuery}>"{trace.query}"</h2>
            <div className={styles.linkedTraceMeta}>
              <span className={styles.queryType}>{trace.queryType}</span>
              {(() => {
                const ltInfo = getDocDisplayInfo('', trace.project);
                return ltInfo.projectVaultUrl ? (
                  <a href={ltInfo.projectVaultUrl} target="_blank" rel="noopener noreferrer" className={styles.projectLink}>🔗 {ltInfo.projectDisplay}</a>
                ) : (<span className={styles.universalBadge}>✦ universal</span>);
              })()}
              <span className={styles.timestamp}>{new Date(trace.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div className={styles.digPoints}>
            {trace.foundFiles?.length > 0 && (
              <section className={styles.section}>
                <h3>Files ({trace.foundFiles.length})</h3>
                <ul className={styles.fileList}>
                  {trace.foundFiles.map((f, i) => (
                    <li key={i} className={styles.fileEntry}>
                      <div className={styles.fileItem}>
                        <span className={styles.filePath}>{f.path}</span>
                        {f.confidence && <span className={styles.confidence}>{f.confidence}</span>}
                        {f.matchReason && <span className={styles.matchReason}>{f.matchReason}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {trace.foundCommits?.length > 0 && (
              <section className={styles.section}>
                <h3>Commits ({trace.foundCommits.length})</h3>
                {trace.project && <div className={styles.commitRepo}>{trace.project}</div>}
                <ul className={styles.commitList}>
                  {trace.foundCommits.map((c, i) => {
                    const repoMatch = c.message?.match(/^([a-zA-Z0-9_-]+):\s/);
                    const org = trace.project?.split('/')[0] || 'LarisLabs';
                    let targetProject = trace.project;
                    if (repoMatch) targetProject = `${org}/${repoMatch[1]}`;
                    const ghProject = targetProject?.includes('github.com') ? targetProject : `github.com/${targetProject}`;
                    const commitUrl = targetProject ? `https://${ghProject}/commit/${c.hash}` : null;
                    const displayHash = c.shortHash || c.hash?.slice(0, 7);
                    return (
                      <li key={i} className={styles.commitItem}>
                        {commitUrl ? (<a href={commitUrl} target="_blank" rel="noopener noreferrer" className={styles.commitHash}>{displayHash}</a>) : (<code className={styles.commitHash}>{displayHash}</code>)}
                        <span className={styles.commitMessage}>{c.message}</span>
                        {c.date && <span className={styles.commitDate}>{c.date}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {trace.foundIssues?.length > 0 && (
              <section className={styles.section}>
                <h3>Issues ({trace.foundIssues.length})</h3>
                {trace.project && <div className={styles.issueRepo}>{trace.project}</div>}
                <ul className={styles.issueList}>
                  {trace.foundIssues.map((issue, i) => {
                    const issueUrl = issue.url || (trace.project ? `https://${trace.project}/issues/${issue.number}` : null);
                    return (
                      <li key={i} className={styles.issueItem}>
                        <span className={`${styles.issueState} ${issue.state === 'open' ? styles.open : styles.closed}`}>#{issue.number}</span>
                        {issueUrl ? (<a href={issueUrl} target="_blank" rel="noopener noreferrer" className={styles.issueTitle}>{issue.title}</a>) : (<span className={styles.issueTitle}>{issue.title}</span>)}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </div>
      ))}
    </SidebarLayout>
  );
}
