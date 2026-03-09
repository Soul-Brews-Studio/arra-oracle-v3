import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { list, getFile, getDoc } from '../api/oracle';
import type { Document } from '../api/oracle';
import { SidebarLayout } from '../components/SidebarLayout';
import { getDocDisplayInfo } from '../utils/docDisplay';
import styles from './DocDetail.module.css';

interface LocationState {
  doc?: Document;
  docs?: Document[];
  currentIndex?: number;
}

export function DocDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [doc, setDoc] = useState<Document | null>(null);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [fileNotFound, setFileNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<{ prev: Document | null; next: Document | null }>({ prev: null, next: null });
  const [showRawModal, setShowRawModal] = useState(false);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Navigate to a document
  const goToDoc = useCallback((targetDoc: Document) => {
    navigate(`/doc/${encodeURIComponent(targetDoc.id)}`, { state: { doc: targetDoc } });
  }, [navigate]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'j' && neighbors.next) {
        goToDoc(neighbors.next);
      } else if (e.key === 'k' && neighbors.prev) {
        goToDoc(neighbors.prev);
      } else if (e.key === 'u') {
        navigate(-1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [neighbors, goToDoc, navigate]);

  // Load full content from file
  useEffect(() => {
    async function loadFullContent() {
      if (!doc?.source_file) return;

      try {
        const fileData = await getFile(doc.source_file, doc.project);
        if (fileData.error) {
          setFileNotFound(true);
        } else if (fileData.content) {
          setFullContent(fileData.content);
          setFileNotFound(false);
        }
      } catch (e) {
        console.error('Failed to load full content:', e);
        setFileNotFound(true);
      }
    }

    setFullContent(null); // Reset when doc changes
    setFileNotFound(false);
    loadFullContent();
  }, [doc]);

  // Load neighbors (prev/next documents)
  useEffect(() => {
    async function loadNeighbors() {
      if (!doc) return;

      try {
        // Check if docs list was passed via state
        const state = location.state as LocationState;
        if (state?.docs && state.currentIndex !== undefined) {
          const idx = state.currentIndex;
          setNeighbors({
            prev: idx > 0 ? state.docs[idx - 1] : null,
            next: idx < state.docs.length - 1 ? state.docs[idx + 1] : null
          });
          return;
        }

        // Otherwise fetch from API
        const data = await list(doc.type, 100, 0);
        const idx = data.results.findIndex(d => d.id === doc.id);
        if (idx !== -1) {
          setNeighbors({
            prev: idx > 0 ? data.results[idx - 1] : null,
            next: idx < data.results.length - 1 ? data.results[idx + 1] : null
          });
        }
      } catch (e) {
        console.error('Failed to load neighbors:', e);
      }
    }

    loadNeighbors();
  }, [doc, location.state]);

  useEffect(() => {
    // Check if document was passed via router state
    const state = location.state as LocationState;
    if (state?.doc) {
      // Use cached doc for instant display
      setDoc(state.doc);
      setLoading(false);
      // But always fetch fresh to get latest data (e.g., project field for GitHub link)
      loadDoc();
      return;
    }

    // Otherwise, search for the document
    loadDoc();
  }, [id, location.state]);

  async function loadDoc() {
    if (!id) return;
    setLoading(true);
    setError(null);

    try {
      const decodedId = decodeURIComponent(id);
      const docData = await getDoc(decodedId);

      if (docData.error) {
        setError('Document not found');
      } else {
        setDoc(docData);
      }
    } catch (e) {
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  }

  // Show raw file in modal
  async function handleShowRawFile(e: React.MouseEvent) {
    e.preventDefault();
    if (!doc?.source_file) return;

    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(doc.source_file)}${doc.project ? `&project=${encodeURIComponent(doc.project)}` : ''}`);
      if (res.ok) {
        const content = await res.text();
        setRawContent(content);
        setShowRawModal(true);
      }
    } catch (err) {
      console.error('Failed to load raw file:', err);
    }
  }

  // Close modal on escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && showRawModal) {
        setShowRawModal(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showRawModal]);

  // Strip YAML frontmatter only, keep all content
  function stripFrontmatter(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith('---')) {
      const endIndex = trimmed.indexOf('---', 3);
      if (endIndex !== -1) {
        return trimmed.slice(endIndex + 3).trim();
      }
    }
    return trimmed;
  }

  // Try to format a date string, return null if invalid
  function tryFormatDate(dateStr: string): string | null {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return null;
    }
  }

  // Extract metadata
  function parseMetadata(doc: Document) {
    const source = doc.source_file || '';
    const content = doc.content || '';

    let when = 'Unknown date';

    // 1. Try YYYY-MM-DD pattern in source_file
    const isoDateMatch = source.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoDateMatch) {
      const formatted = tryFormatDate(isoDateMatch[1]);
      if (formatted) when = formatted;
    }

    // 2. Try YYYY/MM/DD path pattern
    if (when === 'Unknown date') {
      const pathDateMatch = source.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (pathDateMatch) {
        const formatted = tryFormatDate(`${pathDateMatch[1]}-${pathDateMatch[2]}-${pathDateMatch[3]}`);
        if (formatted) when = formatted;
      }
    }

    // 3. Try YYYY-MM/DD path pattern
    if (when === 'Unknown date') {
      const altPathMatch = source.match(/(\d{4})-(\d{2})\/(\d{2})/);
      if (altPathMatch) {
        const formatted = tryFormatDate(`${altPathMatch[1]}-${altPathMatch[2]}-${altPathMatch[3]}`);
        if (formatted) when = formatted;
      }
    }

    // 4. Try doc.id for date pattern
    if (when === 'Unknown date' && doc.id) {
      const idDateMatch = doc.id.match(/(\d{4}-\d{2}-\d{2})/);
      if (idDateMatch) {
        const formatted = tryFormatDate(idDateMatch[1]);
        if (formatted) when = formatted;
      }
    }

    // 5. Try to extract date from content (e.g., "Date: 2026-01-02")
    if (when === 'Unknown date') {
      const contentDateMatch = content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/i);
      if (contentDateMatch) {
        const formatted = tryFormatDate(contentDateMatch[1]);
        if (formatted) when = formatted;
      }
    }

    const what = doc.type.charAt(0).toUpperCase() + doc.type.slice(1);

    const how = source.includes('resonance') ? 'From Resonance Profile'
      : source.includes('retrospective') ? 'From Session Retrospective'
      : source.includes('learnings') ? 'From Discoveries'
      : 'From Knowledge Base';

    return { when, what, how };
  }

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (error || !doc) {
    return (
      <div className={styles.error}>
        <p>{error || 'Document not found'}</p>
        <button onClick={() => navigate(-1)} className={styles.backBtn}>
          Go Back
        </button>
      </div>
    );
  }

  const { when, what, how } = parseMetadata(doc);

  return (
    <SidebarLayout activeType={doc.type}>
    <article className={styles.container}>
      <button onClick={() => navigate(-1)} className={styles.backLink}>
        ← Back to Feed
      </button>

      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.type}>{what}</span>
          <span className={styles.dot}>·</span>
          <span className={styles.when}>{when}</span>
        </div>

        <p className={styles.source}>{how}</p>
      </header>

      <div className={styles.content}>
        <Markdown remarkPlugins={[remarkGfm]}>{stripFrontmatter(fullContent || doc.content)}</Markdown>
      </div>

      {doc.concepts && doc.concepts.length > 0 && (
        <div className={styles.tagsSection}>
          <h3 className={styles.tagsTitle}>Related Concepts</h3>
          <div className={styles.tags}>
            {doc.concepts.map(tag => (
              <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`} className={styles.tag}>
                {tag}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      {(neighbors.prev || neighbors.next) && (
        <nav className={styles.navigation}>
          <button
            onClick={() => neighbors.prev && goToDoc(neighbors.prev)}
            disabled={!neighbors.prev}
            className={styles.navBtn}
          >
            <span className={styles.navKey}>K</span>
            <span className={styles.navLabel}>Previous</span>
          </button>
          <span className={styles.navHint}>J/K navigate · U back</span>
          <button
            onClick={() => neighbors.next && goToDoc(neighbors.next)}
            disabled={!neighbors.next}
            className={styles.navBtn}
          >
            <span className={styles.navLabel}>Next</span>
            <span className={styles.navKey}>J</span>
          </button>
        </nav>
      )}

      <footer className={styles.footer}>
        {fileNotFound && (
          <div className={styles.fileNotFoundSection}>
            <span className={styles.fileNotFound}>⚠️ local file not found</span>
            {doc.project && (
              <span className={styles.projectSource}>📦 Source: {doc.project.replace('github.com/', '')}</span>
            )}
          </div>
        )}
        <div className={styles.footerLinks}>
          {(() => {
            const info = getDocDisplayInfo(doc.source_file, doc.project);

            return (
              <>
                <div className={styles.footerLinksRow}>
                  {info.projectVaultUrl ? (
                    <a
                      href={info.projectVaultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.repoLink}
                    >
                      🔗 {info.projectDisplay}
                    </a>
                  ) : (
                    <span className={styles.universalBadge}>✦ universal</span>
                  )}
                  {info.fileUrl && (
                    <a
                      href={info.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.githubLink}
                    >
                      View on GitHub ↗
                    </a>
                  )}
                  {info.vaultUrl && (
                    <a
                      href={info.vaultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.vaultLink}
                    >
                      🏛️ vault
                    </a>
                  )}
                </div>
                {!fileNotFound ? (
                  <button
                    onClick={handleShowRawFile}
                    className={styles.sourcePath}
                  >
                    📁 {info.displayPath}
                  </button>
                ) : (
                  <span className={styles.sourcePathMuted}>📁 {info.displayPath}</span>
                )}
              </>
            );
          })()}
        </div>
      </footer>

      {/* Raw File Modal */}
      {showRawModal && rawContent && (
        <div className={styles.modalOverlay} onClick={() => setShowRawModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()} ref={modalRef}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>📁 {doc.source_file}</span>
              <button className={styles.modalClose} onClick={() => setShowRawModal(false)}>×</button>
            </div>
            <pre className={styles.modalContent}>{rawContent.split('\n').map((line, i) => (
              <div key={i} className={styles.codeLine}>
                <span className={styles.lineNumber}>{i + 1}</span>
                <span className={styles.lineContent}>{line || ' '}</span>
              </div>
            ))}</pre>
          </div>
        </div>
      )}
    </article>
    </SidebarLayout>
  );
}
