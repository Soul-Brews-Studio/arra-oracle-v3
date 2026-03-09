import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { search } from '../api/oracle';
import type { Document } from '../api/oracle';
import { LogCard } from '../components/LogCard';
import styles from './Search.module.css';

export function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setQuery(q);
      doSearch(q);
    }
  }, [searchParams]);

  async function doSearch(q: string) {
    if (!q.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const data = await search(q, 'all', 50);
      setResults(data.results);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query });
      // doSearch is called by useEffect when searchParams changes
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Search Oracle</h1>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search for patterns, principles, learnings..."
          className={styles.input}
          autoFocus
        />
        <button type="submit" className={styles.button}>
          Search
        </button>
      </form>

      {loading && <div className={styles.loading}>Searching...</div>}

      {!loading && searched && (
        <div className={styles.results}>
          <p className={styles.meta}>
            {total} results for "{searchParams.get('q')}"
          </p>

          {results.length > 0 ? (
            <div className={styles.list}>
              {results.map(doc => (
                <LogCard key={doc.id} doc={doc} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              No results found. Try a different search term.
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className={styles.suggestions}>
          <p className={styles.suggestionsTitle}>Try searching for:</p>
          <div className={styles.suggestionList}>
            {['trust', 'safety', 'git', 'context', 'pattern'].map(term => (
              <button
                key={term}
                onClick={() => {
                  setQuery(term);
                  setSearchParams({ q: term });
                  doSearch(term);
                }}
                className={styles.suggestion}
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
