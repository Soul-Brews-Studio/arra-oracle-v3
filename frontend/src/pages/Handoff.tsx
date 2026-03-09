import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import { SidebarLayout, TOOLS_NAV } from '../components/SidebarLayout';
import styles from './Handoff.module.css';

interface HandoffFile {
  filename: string;
  path: string;
  created: string;
  preview: string;
  type: string;
}

export function Handoff() {
  const [files, setFiles] = useState<HandoffFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    loadInbox();
  }, []);

  async function loadInbox() {
    setLoading(true);
    try {
      const res = await fetch('/api/inbox?limit=50');
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        setTotal(data.total || 0);
      }
    } catch (e) {
      console.error('Failed to load inbox:', e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(file: HandoffFile) {
    if (expanded === file.filename) {
      setExpanded(null);
      setFullContent(null);
      return;
    }

    setExpanded(file.filename);
    setFullContent(null);
    setLoadingContent(true);

    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
      if (res.ok) {
        const text = await res.text();
        setFullContent(text);
      } else {
        setFullContent(file.preview);
      }
    } catch {
      setFullContent(file.preview);
    } finally {
      setLoadingContent(false);
    }
  }

  function formatDate(created: string): string {
    if (created === 'unknown') return 'Unknown date';
    try {
      return new Date(created).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return created;
    }
  }

  function extractTitle(preview: string): string {
    // Try to get first heading or first line
    const headingMatch = preview.match(/^#\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    const firstLine = preview.split('\n').find(l => l.trim().length > 0);
    return firstLine?.substring(0, 80) || 'Untitled handoff';
  }

  return (
    <SidebarLayout navItems={TOOLS_NAV} navTitle="Tools" filters={[]}>
      <h1 className={styles.title}>Inbox</h1>
      <p className={styles.subtitle}>
        Session handoffs from <code>oracle_handoff()</code>
      </p>

      {loading ? (
        <div className={styles.loading}>Loading inbox...</div>
      ) : files.length === 0 ? (
        <div className={styles.empty}>
          <p>No handoffs yet.</p>
          <p className={styles.hint}>
            Use <code>oracle_handoff(content)</code> to save session context for future sessions.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.stats}>
            {total} handoff{total !== 1 ? 's' : ''}
          </div>

          <div className={styles.list}>
            {files.map(file => (
              <div key={file.filename} className={styles.item}>
                <div
                  className={styles.itemHeader}
                  onClick={() => toggleExpand(file)}
                >
                  <div className={styles.itemTitle}>
                    {extractTitle(file.preview)}
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.date}>{formatDate(file.created)}</span>
                    <span className={styles.filename}>{file.filename}</span>
                  </div>
                </div>

                {expanded === file.filename && (
                  <div className={styles.content}>
                    {loadingContent ? (
                      <div className={styles.loading}>Loading...</div>
                    ) : (
                      <div className={styles.preview}>
                        <Markdown>{fullContent || file.preview}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </SidebarLayout>
  );
}
