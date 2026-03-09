import { Link } from 'react-router-dom';
import type { Document } from '../api/oracle';
import { getDocDisplayInfo } from '../utils/docDisplay';
import styles from './LogCard.module.css';

interface LogCardProps {
  doc: Document;
}

// Try to format a date string, return null if invalid
function tryFormatDate(dateStr: string): string | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return null;
  }
}

// Extract metadata from content/source
function parseMetadata(doc: Document) {
  const source = doc.source_file || '';
  const content = doc.content || '';

  // Try multiple date extraction strategies
  let when = 'Unknown date';

  // 1. Try YYYY-MM-DD pattern in source_file (most common)
  const isoDateMatch = source.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) {
    const formatted = tryFormatDate(isoDateMatch[1]);
    if (formatted) when = formatted;
  }

  // 2. Try YYYY/MM/DD path pattern (e.g., retrospectives/2026/01/02/)
  if (when === 'Unknown date') {
    const pathDateMatch = source.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (pathDateMatch) {
      const formatted = tryFormatDate(`${pathDateMatch[1]}-${pathDateMatch[2]}-${pathDateMatch[3]}`);
      if (formatted) when = formatted;
    }
  }

  // 3. Try YYYY-MM/DD path pattern (e.g., 2026-01/03/)
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

  // What: document type
  const what = doc.type.charAt(0).toUpperCase() + doc.type.slice(1);

  // How: source context
  const how = source.includes('resonance') ? 'Resonance'
    : source.includes('retrospective') ? 'Session'
    : source.includes('learnings') ? 'Discovery'
    : 'Knowledge Base';

  return { when, what, how };
}

// Parse YAML frontmatter and return { title, body }
function parseFrontmatter(content: string): { title: string | null; body: string } {
  const trimmed = content.trim();

  // Check if content starts with YAML frontmatter
  if (trimmed.startsWith('---')) {
    const endIndex = trimmed.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = trimmed.slice(3, endIndex);
      const body = trimmed.slice(endIndex + 3).trim();

      // Extract title from frontmatter
      const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/);
      const title = titleMatch ? titleMatch[1].trim() : null;

      return { title, body };
    }
  }

  return { title: null, body: trimmed };
}

// Get preview text (first ~150 chars of body content)
function getPreview(content: string): string {
  const { body } = parseFrontmatter(content);
  const cleaned = body.replace(/\*\*/g, '').replace(/`/g, '').replace(/^#+\s*/gm, '').trim();
  if (cleaned.length <= 150) return cleaned;
  return cleaned.slice(0, 150).trim() + '...';
}

// Get title from frontmatter or first line of body
function getTitle(content: string): string {
  const { title, body } = parseFrontmatter(content);

  // Use frontmatter title if available
  if (title) {
    if (title.length <= 80) return title;
    return title.slice(0, 80).trim() + '...';
  }

  // Fall back to first line of body
  const cleaned = body.replace(/\*\*/g, '').replace(/`/g, '').replace(/^#+\s*/gm, '').trim();
  const firstLine = cleaned.split('\n')[0];
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 80).trim() + '...';
}

interface LogCardOptions {
  showScore?: boolean;
}

export function LogCard({ doc, showScore }: LogCardProps & LogCardOptions) {
  const { when, what, how } = parseMetadata(doc);
  const title = getTitle(doc.content);
  const preview = getPreview(doc.content);
  const info = getDocDisplayInfo(doc.source_file, doc.project);
  const scorePercent = doc.score != null ? Math.round(doc.score * 100) : null;

  // Create URL-safe ID
  const docId = encodeURIComponent(doc.id);

  // Card opacity scales subtly with score
  const cardStyle = showScore && doc.score != null
    ? { opacity: 0.6 + doc.score * 0.4 } as React.CSSProperties
    : undefined;

  return (
    <Link to={`/doc/${docId}`} state={{ doc }} className={styles.card} style={cardStyle}>
      {showScore && scorePercent != null && (
        <div className={styles.scoreRow}>
          <div className={styles.scoreBar}>
            <div
              className={styles.scoreBarFill}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
          <span className={styles.scoreLabel}>{scorePercent}%</span>
          {doc.source && (
            <span className={`${styles.sourceBadge} ${styles[`source_${doc.source}`]}`}>
              {doc.source.toUpperCase()}
            </span>
          )}
        </div>
      )}

      <div className={styles.meta}>
        <span className={styles.when}>{when}</span>
        <span className={styles.dot}>·</span>
        <span className={styles.what}>{what}</span>
        <span className={styles.dot}>·</span>
        <span className={styles.how}>{how}</span>
        {info.projectDisplay ? (
          <span className={styles.projectBadge}>🔗 {info.projectDisplay}</span>
        ) : (
          <span className={styles.universalBadge}>✦ universal</span>
        )}
      </div>

      <h2 className={styles.title}>{title}</h2>

      <p className={styles.preview}>{preview}</p>

      {doc.concepts && doc.concepts.length > 0 && (
        <div className={styles.tags}>
          {doc.concepts.slice(0, 5).map(tag => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
          {doc.concepts.length > 5 && (
            <span className={styles.moreTag}>+{doc.concepts.length - 5}</span>
          )}
        </div>
      )}
    </Link>
  );
}
