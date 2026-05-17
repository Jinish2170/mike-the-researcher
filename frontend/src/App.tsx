import { useEffect, useState } from 'react';
import './App.css';

type Depth = 'quick' | 'standard' | 'deep';
type Tab = 'brief' | 'sources' | 'history';

interface Source {
  id: number;
  url: string;
  title: string;
  domain: string;
  snippet: string;
  charCount: number;
  fetchedAt: string;
  status: 'ok' | 'failed' | 'skipped';
  failureReason?: string;
}

interface ResearchBrief {
  summary: string;
  keyPoints: string[];
  followUpQuestions: string[];
  confidence: 'low' | 'medium' | 'high';
  reasoning?: string;
}

interface ResearchRecord {
  id: string;
  query: string;
  depth: Depth;
  brief: ResearchBrief;
  sources: Source[];
  stats: {
    searchResults: number;
    sourcesFetched: number;
    sourcesFailed: number;
    totalCharsRead: number;
    durationMs: number;
    model: string;
  };
  createdAt: string;
}

interface HistoryItem {
  id: string;
  query: string;
  depth: Depth;
  createdAt: string;
  stats: ResearchRecord['stats'];
  oneLine: string;
}

interface ProgressEvent {
  phase: string;
  message: string;
}

const DEPTHS: { value: Depth; label: string; help: string }[] = [
  { value: 'quick',    label: 'Quick',    help: '3 sources · ~10s' },
  { value: 'standard', label: 'Standard', help: '6 sources · ~25s' },
  { value: 'deep',     label: 'Deep',     help: '10 sources · ~60s' },
];

function App() {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<Depth>('standard');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<ResearchRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('brief');
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/researches?limit=50');
      if (!res.ok) return;
      const j = await res.json();
      setHistory(j.researches || []);
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab]);

  const runResearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress([]);
    setTab('brief');

    try {
      const res = await fetch('/api/research/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), depth }),
      });
      if (!res.body) throw new Error('No stream from server');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const block of events) {
          if (!block.trim()) continue;
          const lines = block.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event:'));
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const eventName = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim());
          if (eventName === 'progress') {
            setProgress((p) => [...p, data as ProgressEvent]);
          } else if (eventName === 'result') {
            setResult(data as ResearchRecord);
          } else if (eventName === 'error') {
            setError(data?.message || 'Research failed');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadHistorical = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Not found');
      const j = await res.json();
      setResult(j as ResearchRecord);
      setQuery(j.query);
      setDepth(j.depth);
      setTab('brief');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportJSON = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mike-${result.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderSummary = (text: string) => {
    // Linkify citations like [1], [2,3]
    const parts = text.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
    return parts.map((part, i) => {
      const m = part.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/);
      if (!m) return <span key={i}>{part}</span>;
      const nums = m[1].split(/\s*,\s*/).map(Number);
      return (
        <span key={i}>
          {nums.map((n, j) => {
            const src = result?.sources.find((s) => s.id === n);
            return (
              <a
                key={j}
                className="cite"
                href={src?.url || '#'}
                target="_blank"
                rel="noreferrer"
                title={src?.title || `Source ${n}`}
              >
                {n}
              </a>
            );
          })}
        </span>
      );
    });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-icon">M</span>
          <h1>Mike the Researcher</h1>
        </div>
        <p className="tagline">AI research assistant — searches the web, reads the sources, cites every claim</p>
      </header>

      <div className="controls">
        <div className="input-group">
          <label>Research question</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && runResearch()}
            placeholder='e.g. "what is retrieval-augmented generation and when does it beat fine-tuning?"'
          />
        </div>
        <div className="select-group">
          <label>Depth</label>
          <select value={depth} onChange={(e) => setDepth(e.target.value as Depth)}>
            {DEPTHS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label} — {d.help}
              </option>
            ))}
          </select>
        </div>
        <button onClick={runResearch} disabled={loading || !query.trim()} className="scan-btn">
          {loading ? 'Researching...' : 'Research'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && progress.length > 0 && (
        <div className="progress">
          {progress.map((p, i) => (
            <div key={i} className="progress-line">
              <span className="phase">{p.phase}</span>
              {p.message}
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'brief' ? 'active' : ''} onClick={() => setTab('brief')}>
          Brief
        </button>
        <button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}>
          Sources{result ? ` (${result.sources.length})` : ''}
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          History
        </button>
        {result && (
          <button onClick={exportJSON} className="export-btn">
            ⬇ Export JSON
          </button>
        )}
      </div>

      {tab === 'brief' && (
        <div className="tab-content">
          {!result && !loading && (
            <p style={{ color: 'var(--text-secondary)' }}>
              Ask Mike a question above. He'll search the web, read the top sources, and synthesize a cited brief.
            </p>
          )}
          {result && (
            <>
              <div className="stats-bar">
                <div className="stat">
                  <span className="stat-value">{result.stats.sourcesFetched}</span>
                  <span className="stat-label">Sources used</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{result.stats.totalCharsRead.toLocaleString()}</span>
                  <span className="stat-label">Chars read</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{(result.stats.durationMs / 1000).toFixed(1)}s</span>
                  <span className="stat-label">Duration</span>
                </div>
                <div className="stat">
                  <span className={`confidence-pill ${result.brief.confidence}`}>
                    {result.brief.confidence}
                  </span>
                  <span className="stat-label" style={{ marginTop: '0.4rem', display: 'block' }}>
                    Confidence
                  </span>
                </div>
              </div>

              <div className="summary-box section">
                <h3>Summary</h3>
                <div className="summary-text">{renderSummary(result.brief.summary)}</div>
              </div>

              {result.brief.keyPoints.length > 0 && (
                <div className="summary-box section">
                  <h3>Key points</h3>
                  <ul className="bullets">
                    {result.brief.keyPoints.map((p, i) => (
                      <li key={i}>{renderSummary(p)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.brief.followUpQuestions.length > 0 && (
                <div className="summary-box section">
                  <h3>Follow-up questions</h3>
                  <ul className="bullets">
                    {result.brief.followUpQuestions.map((q, i) => (
                      <li
                        key={i}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setQuery(q);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        title="Click to set as next query"
                      >
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.brief.reasoning && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '1rem' }}>
                  <strong>Confidence reasoning:</strong> {result.brief.reasoning}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="tab-content">
          {!result && <p style={{ color: 'var(--text-secondary)' }}>Run a query to see sources.</p>}
          {result &&
            result.sources.map((s) => (
              <div key={s.id} className={`source-card ${s.status === 'failed' ? 'failed' : ''}`}>
                <div className="source-head">
                  <span className="source-num">{s.id}</span>
                  <span className="source-title">{s.title}</span>
                  <span className="source-domain">{s.domain}</span>
                </div>
                <a className="source-link" href={s.url} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
                {s.status === 'failed' ? (
                  <p className="source-snippet" style={{ color: 'var(--danger)' }}>
                    Could not extract: {s.failureReason}
                  </p>
                ) : (
                  <p className="source-snippet">
                    {s.snippet} <span style={{ color: 'var(--text-secondary)' }}>· {s.charCount.toLocaleString()} chars</span>
                  </p>
                )}
              </div>
            ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="tab-content">
          {history.length === 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>
              No past research yet. Run a query to start building history.
            </p>
          )}
          {history.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Query</th>
                  <th>Depth</th>
                  <th>Sources</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.query}</td>
                    <td>{h.depth}</td>
                    <td>{h.stats.sourcesFetched}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {new Date(h.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => loadHistorical(h.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
