import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from './Forum.module.css';

interface Thread {
  id: number;
  title: string;
  status: 'active' | 'answered' | 'pending' | 'closed';
  message_count: number;
  created_at: string;
  issue_url: string | null;
}

interface Message {
  id: number;
  role: 'human' | 'oracle' | 'claude';
  content: string;
  author: string | null;
  principles_found: number | null;
  patterns_found: number | null;
  created_at: string;
}

interface ThreadDetail {
  thread: {
    id: number;
    title: string;
    status: string;
    created_at: string;
    issue_url: string | null;
  };
  messages: Message[];
}

const API_BASE = '/api';

async function fetchThreads(): Promise<{ threads: Thread[]; total: number }> {
  const res = await fetch(`${API_BASE}/threads`);
  return res.json();
}

async function fetchThread(id: number): Promise<ThreadDetail> {
  const res = await fetch(`${API_BASE}/thread/${id}`);
  return res.json();
}

async function sendMessage(message: string, threadId?: number, title?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/thread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, thread_id: threadId, title })
  });
  return res.json();
}

async function updateThreadStatus(threadId: number, status: string): Promise<any> {
  const res = await fetch(`${API_BASE}/thread/${threadId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  return res.json();
}

export function Forum() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const threadIdParam = searchParams.get('thread');
  const showNewThread = searchParams.get('new') === 'true';

  useEffect(() => {
    loadThreads();
  }, []);

  // Load thread from URL param or auto-select first
  useEffect(() => {
    if (threadIdParam) {
      selectThread(parseInt(threadIdParam, 10));
    } else if (threads.length > 0 && !showNewThread) {
      // Auto-select first thread
      setSearchParams({ thread: threads[0].id.toString() });
    } else {
      setSelectedThread(null);
    }
  }, [threadIdParam, threads]);

  async function loadThreads() {
    const data = await fetchThreads();
    setThreads(data.threads);
  }

  async function selectThread(id: number) {
    const data = await fetchThread(id);
    setSelectedThread(data);
    setSearchParams({ thread: id.toString() });
  }

  function openNewThread() {
    setSearchParams({ new: 'true' });
    setSelectedThread(null);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setLoading(true);
    try {
      if (selectedThread) {
        // Continue existing thread
        await sendMessage(newMessage, selectedThread.thread.id);
        // Reload thread to see new messages
        const data = await fetchThread(selectedThread.thread.id);
        setSelectedThread(data);
      } else if (showNewThread) {
        // Create new thread
        const result = await sendMessage(newMessage, undefined, newTitle || undefined);
        await loadThreads();
        setSearchParams({ thread: result.thread_id.toString() });
      }
      setNewMessage('');
      setNewTitle('');
    } finally {
      setLoading(false);
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'answered': return '#22c55e';
      case 'pending': return '#eab308';
      case 'active': return '#3b82f6';
      case 'closed': return '#6b7280';
      default: return '#6b7280';
    }
  }

  async function handleToggleThread() {
    if (!selectedThread) return;
    const newStatus = selectedThread.thread.status === 'closed' ? 'active' : 'closed';
    try {
      const result = await updateThreadStatus(selectedThread.thread.id, newStatus);
      console.log('Status update:', result);
      const data = await fetchThread(selectedThread.thread.id);
      setSelectedThread(data);
      await loadThreads();
    } catch (err) {
      console.error('Failed to update thread:', err);
    }
  }

  function formatTime(iso: string) {
    const date = new Date(iso);
    return date.toLocaleString();
  }

  return (
    <div className={styles.container}>
      {/* Sidebar: Thread List */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h2>Threads</h2>
          <button
            className={styles.newButton}
            onClick={openNewThread}
          >
            + New
          </button>
        </div>

        <div className={styles.threadList}>
          {threads.map(thread => (
            <div
              key={thread.id}
              className={`${styles.threadItem} ${selectedThread?.thread.id === thread.id ? styles.active : ''}`}
              onClick={() => setSearchParams({ thread: thread.id.toString() })}
            >
              <div className={styles.threadTitle}>{thread.title}</div>
              <div className={styles.threadMeta}>
                <span
                  className={styles.status}
                  style={{ backgroundColor: getStatusColor(thread.status) }}
                >
                  {thread.status}
                </span>
                <span className={styles.count}>{thread.message_count} msgs</span>
              </div>
            </div>
          ))}

          {threads.length === 0 && (
            <div className={styles.empty}>No threads yet</div>
          )}
        </div>
      </div>

      {/* Main: Thread Detail or New Thread */}
      <div className={styles.main}>
        {showNewThread && !selectedThread && (
          <div className={styles.newThread}>
            <h2>Start New Discussion</h2>
            <form onSubmit={handleSendMessage} className={styles.form}>
              <input
                type="text"
                placeholder="Thread title (optional)"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className={styles.input}
              />
              <textarea
                placeholder="Ask Oracle a question..."
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                className={styles.textarea}
                rows={4}
              />
              <button
                type="submit"
                disabled={loading || !newMessage.trim()}
                className={styles.submitButton}
              >
                {loading ? 'Sending...' : 'Ask Oracle'}
              </button>
            </form>
          </div>
        )}

        {selectedThread && (
          <div className={styles.threadDetail}>
            <div className={styles.threadHeader}>
              <h2>{selectedThread.thread.title}</h2>
              <div className={styles.threadActions}>
                <span
                  className={styles.statusBadge}
                  style={{ backgroundColor: getStatusColor(selectedThread.thread.status) }}
                >
                  {selectedThread.thread.status}
                </span>
                <button
                  onClick={handleToggleThread}
                  className={styles.closeButton}
                >
                  {selectedThread.thread.status === 'closed' ? 'Reopen' : 'Close'}
                </button>
              </div>
            </div>

            <div className={styles.messages}>
              {selectedThread.messages.map(msg => (
                <div
                  key={msg.id}
                  className={`${styles.message} ${styles[msg.role]}`}
                >
                  <div className={styles.messageHeader}>
                    <span className={styles.role}>
                      {msg.role === 'oracle'
                        ? '🔮 Oracle'
                        : msg.role === 'claude'
                          ? `🤖 ${msg.author || 'Claude'}`
                          : `👤 ${msg.author || 'User'}`}
                    </span>
                    <span className={styles.time}>{formatTime(msg.created_at)}</span>
                  </div>
                  <div className={styles.messageContent}>
                    {msg.content}
                  </div>
                  {msg.patterns_found !== null && msg.patterns_found > 0 && (
                    <div className={styles.messageMeta}>
                      Found {msg.patterns_found} patterns
                    </div>
                  )}
                </div>
              ))}
            </div>

            <form onSubmit={handleSendMessage} className={styles.replyForm}>
              <textarea
                placeholder="Continue the discussion..."
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                className={styles.textarea}
                rows={3}
              />
              <button
                type="submit"
                disabled={loading || !newMessage.trim()}
                className={styles.submitButton}
              >
                {loading ? 'Sending...' : 'Reply'}
              </button>
            </form>
          </div>
        )}

        {!showNewThread && !selectedThread && (
          <div className={styles.placeholder}>
            <p>Select a thread or start a new discussion</p>
          </div>
        )}
      </div>
    </div>
  );
}
