import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { list } from '../api/oracle';
import type { Document } from '../api/oracle';
import { LogCard } from '../components/LogCard';
import { SidebarLayout } from '../components/SidebarLayout';
import styles from './Feed.module.css';

export function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Get type from URL or default to 'all'
  const type = searchParams.get('type') || 'all';

  function setType(newType: string) {
    if (newType === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ type: newType });
    }
  }

  useEffect(() => {
    loadDocs(true);
  }, [type]);

  async function loadDocs(reset = false) {
    setLoading(true);
    try {
      const newOffset = reset ? 0 : offset;
      const data = await list(type, 20, newOffset);
      if (reset) {
        setDocs(data.results);
        setOffset(20);
      } else {
        setDocs(prev => [...prev, ...data.results]);
        setOffset(prev => prev + 20);
      }
      setHasMore(data.results.length >= 20);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SidebarLayout activeType={type} onTypeChange={setType}>
      <h1 className={styles.title}>Knowledge Feed</h1>
      <p className={styles.subtitle}>
        Browse Oracle's indexed knowledge — principles, learnings, and retrospectives
      </p>

      <div className={styles.feed}>
        {docs.map(doc => (
          <LogCard key={doc.id} doc={doc} />
        ))}
      </div>

      {loading && <div className={styles.loading}>Loading...</div>}

      {!loading && hasMore && (
        <button type="button" onClick={() => loadDocs(false)} className={styles.loadMore}>
          Load More
        </button>
      )}
    </SidebarLayout>
  );
}
