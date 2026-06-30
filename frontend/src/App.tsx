import { useEffect, useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

type Depth = 'quick' | 'standard' | 'deep';
type Tab = 'brief' | 'sources' | 'history';
type SourceCategory = 'academic' | 'news' | 'official' | 'blog' | 'reference' | 'other';

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
  qualityScore?: number;
  category?: SourceCategory;
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
  { value: 'quick', label: 'Quick', help: '3 sources · ~10s · single-pass' },
  { value: 'standard', label: 'Standard', help: '6 sources · ~25s · GEPA loop' },
  { value: 'deep', label: 'Deep', help: '10+ sources · ~60s · multi-pass + academic' },
];

const CATEGORY_LABELS: Record<SourceCategory, string> = {
  academic: 'Academic',
  news: 'News',
  official: 'Official',
  blog: 'Blog',
  reference: 'Reference',
  other: 'Web',
};

function QualityDot({ score }: { score?: number }) {
  if (score == null) return null;
  const cls = score >= 0.6 ? 'high' : score >= 0.35 ? 'medium' : 'low';
  return <span className={`quality-dot ${cls}`} title={`Quality: ${Math.round(score * 100)}%`} />;
}

function CategoryBadge({ category }: { category?: SourceCategory }) {
  if (!category) return null;
  return <span className={`category-badge cat-${category}`}>{CATEGORY_LABELS[category]}</span>;
}

function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-block">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

function CitedMarkdown({ text, sources }: { text: string; sources: Source[] }) {
  const processed = text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums: string) => {
    const ids = nums.split(/\s*,\s*/);
    return ids
      .map((n: string) => {
        const src = sources.find((s) => s.id === parseInt(n));
        const url = src?.url || '#';
        const title = src?.title || `Source ${n}`;
        return `[<sup>${n}</sup>](${url} "${title}")`;
      })
      .join('');
  });

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, title, children }) => (
          <a href={href} target="_blank" rel="noreferrer" title={title || undefined} className="cite-link">
            {children}
          </a>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}

function App() {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<Depth>('standard');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<ResearchRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('brief');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressEndRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/researches?limit=50');
      if (!res.ok) return;
      const j = await res.json();
      setHistory(j.researches || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progress]);

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

  const setFollowUp = (q: string) => {
    setQuery(q);
    inputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const okSources = result?.sources.filter((s) => s.status === 'ok') || [];

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-icon">M</span>
          <h1>Mike the Researcher</h1>
        </div>
        <p className="tagline">
          Advanced AI research agent — GEPA loop, multi-pass synthesis, cited briefs
        </p>
      </header>

      <div className="controls" role="search">
        <div className="input-group">
          <label htmlFor="research-input">Research question</label>
          <input
            id="research-input"
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && runResearch()}
            placeholder='e.g. "compare RAG vs fine-tuning for enterprise LLMs"'
            aria-label="Research question"
          />
        </div>
        <div className="select-group">
          <label htmlFor="depth-select">Depth</label>
          <select
            id="depth-select"
            value={depth}
            onChange={(e) => setDepth(e.target.value as Depth)}
            aria-label="Research depth"
          >
            {DEPTHS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label} — {d.help}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={runResearch}
          disabled={loading || !query.trim()}
          className="scan-btn"
          aria-label="Start research"
        >
          {loading ? 'Researching...' : 'Research'}
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading && progress.length > 0 && (
        <div className="progress" aria-live="polite" aria-label="Research progress">
          {progress.map((p, i) => (
            <div key={i} className="progress-line">
              <span className={`phase phase-${p.phase}`}>{p.phase}</span>
              {p.message}
            </div>
          ))}
          <div ref={progressEndRef} />
        </div>
      )}

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'brief'}
          className={tab === 'brief' ? 'active' : ''}
          onClick={() => setTab('brief')}
        >
          Brief
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sources'}
          className={tab === 'sources' ? 'active' : ''}
          onClick={() => setTab('sources')}
        >
          Sources{result ? ` (${result.sources.length})` : ''}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'history'}
          className={tab === 'history' ? 'active' : ''}
          onClick={() => setTab('history')}
        >
          History
        </button>
        {result && (
          <button onClick={exportJSON} className="export-btn" aria-label="Export as JSON">
            Export JSON
          </button>
        )}
      </div>

      {tab === 'brief' && (
        <div className="tab-content" role="tabpanel">
          {!result && !loading && (
            <div className="empty-state">
              <p>Ask Mike a question. He uses a <strong>GEPA research loop</strong> (Generate-Evaluate-Plan-Act) to iteratively search, evaluate coverage gaps, and fill them before synthesis.</p>
              <div className="depth-info">
                <div className="depth-card">
                  <strong>Quick</strong>
                  <span>Single-pass synthesis, 3 sources</span>
                </div>
                <div className="depth-card">
                  <strong>Standard</strong>
                  <span>Multi-query + gap analysis, 6 sources</span>
                </div>
                <div className="depth-card">
                  <strong>Deep</strong>
                  <span>Multi-pass fact extraction, academic search, 10+ sources</span>
                </div>
              </div>
            </div>
          )}

          {loading && !result && (
            <div className="skeleton-container">
              <div className="stats-bar">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="stat">
                    <div className="skeleton" style={{ width: '40%', height: '1.6rem', margin: '0 auto' }} />
                    <div className="skeleton" style={{ width: '60%', height: '0.7rem', margin: '0.4rem auto 0' }} />
                  </div>
                ))}
              </div>
              <div className="summary-box section">
                <h3>Summary</h3>
                <SkeletonBlock lines={5} />
              </div>
              <div className="summary-box section">
                <h3>Key points</h3>
                <SkeletonBlock lines={4} />
              </div>
            </div>
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
                <div className="summary-text">
                  <CitedMarkdown text={result.brief.summary} sources={result.sources} />
                </div>
              </div>

              {result.brief.keyPoints.length > 0 && (
                <div className="summary-box section">
                  <h3>Key points</h3>
                  <ul className="bullets">
                    {result.brief.keyPoints.map((p, i) => (
                      <li key={i}>
                        <CitedMarkdown text={p} sources={result.sources} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.brief.followUpQuestions.length > 0 && (
                <div className="summary-box section">
                  <h3>Follow-up questions</h3>
                  <ul className="bullets follow-ups">
                    {result.brief.followUpQuestions.map((q, i) => (
                      <li
                        key={i}
                        role="button"
                        tabIndex={0}
                        onClick={() => setFollowUp(q)}
                        onKeyDown={(e) => e.key === 'Enter' && setFollowUp(q)}
                        title="Click to set as next query"
                      >
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.brief.reasoning && (
                <p className="confidence-reasoning">
                  <strong>Confidence reasoning:</strong> {result.brief.reasoning}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="tab-content" role="tabpanel">
          {!result && <p style={{ color: 'var(--text-secondary)' }}>Run a query to see sources.</p>}
          {result && (
            <>
              <div className="source-summary-bar">
                <span>{okSources.length} fetched</span>
                <span>{result.stats.sourcesFailed} failed</span>
                {okSources.some((s) => s.category) && (
                  <span className="category-breakdown">
                    {Object.entries(
                      okSources.reduce((acc, s) => {
                        const cat = s.category || 'other';
                        acc[cat] = (acc[cat] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    )
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, count]) => `${count} ${cat}`)
                      .join(' · ')}
                  </span>
                )}
              </div>
              {result.sources.map((s) => (
                <div key={s.id} className={`source-card ${s.status === 'failed' ? 'failed' : ''}`}>
                  <div className="source-head">
                    <span className="source-num">{s.id}</span>
                    <QualityDot score={s.qualityScore} />
                    <span className="source-title">{s.title}</span>
                    <CategoryBadge category={s.category} />
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
                      {s.snippet}{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>
                        · {s.charCount.toLocaleString()} chars
                        {s.qualityScore != null && ` · score ${Math.round(s.qualityScore * 100)}%`}
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="tab-content" role="tabpanel">
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
                    <td>
                      <span className={`depth-badge depth-${h.depth}`}>{h.depth}</span>
                    </td>
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
