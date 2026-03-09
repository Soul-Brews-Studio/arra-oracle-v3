import { useState, useEffect } from 'react';
import { learn } from '../api/oracle';
import styles from './QuickLearn.module.css';

export function QuickLearn() {
  const [isOpen, setIsOpen] = useState(false);
  const [pattern, setPattern] = useState('');
  const [concepts, setConcepts] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Listen for quicklearn:open event from Activity page
  useEffect(() => {
    function handleQuickLearnOpen(e: CustomEvent<{ query: string }>) {
      const topic = e.detail.query;
      setPattern(`About "${topic}":\n\n`);
      // Extract potential concepts from query
      const words = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      setConcepts(words.slice(0, 3).join(', '));
      setIsOpen(true);
    }

    window.addEventListener('quicklearn:open', handleQuickLearnOpen as EventListener);
    return () => {
      window.removeEventListener('quicklearn:open', handleQuickLearnOpen as EventListener);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim()) return;

    setLoading(true);
    setMessage(null);

    try {
      const conceptList = concepts
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      const result = await learn(pattern, conceptList);

      if (result.success) {
        setMessage({ type: 'success', text: 'Learning saved!' });
        setPattern('');
        setConcepts('');

        // Update session stats
        const stored = localStorage.getItem('oracle_session');
        if (stored) {
          const stats = JSON.parse(stored);
          stats.learnings = (stats.learnings || 0) + 1;
          localStorage.setItem('oracle_session', JSON.stringify(stats));
        }

        // Auto close after success
        setTimeout(() => {
          setIsOpen(false);
          setMessage(null);
        }, 1500);
      } else {
        setMessage({ type: 'error', text: 'Failed to save learning' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to save learning' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className={styles.fab}
        onClick={() => setIsOpen(true)}
        title="Quick Learn"
      >
        +
      </button>

      {isOpen && (
        <div className={styles.overlay} onClick={() => setIsOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.header}>
              <h2 className={styles.title}>Add Learning</h2>
              <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>What pattern or insight did you learn?</label>
                <textarea
                  value={pattern}
                  onChange={e => setPattern(e.target.value)}
                  placeholder="Describe the pattern, principle, or lesson..."
                  className={styles.textarea}
                  rows={4}
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Concepts (comma separated)</label>
                <input
                  type="text"
                  value={concepts}
                  onChange={e => setConcepts(e.target.value)}
                  placeholder="git, safety, trust"
                  className={styles.input}
                />
              </div>

              {message && (
                <div className={`${styles.message} ${styles[message.type]}`}>
                  {message.text}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !pattern.trim()}
                className={styles.submitBtn}
              >
                {loading ? 'Saving...' : 'Save Learning'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
