// Mike the Researcher — Express API server
import express from 'express';
import cors from 'cors';
import { research } from '../research/engine';
import { getResearchStore } from '../research/store';
import { CONFIG } from '../config';
import { ResearchDepth } from '../types';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

interface ResearchRequest {
  query: string;
  depth?: ResearchDepth;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/research', async (req, res): Promise<void> => {
  const { query, depth = 'standard' } = (req.body || {}) as ResearchRequest;

  if (!query || typeof query !== 'string' || query.trim().length < 3) {
    res.status(400).json({ error: 'A research question (>=3 chars) is required' });
    return;
  }
  if (!['quick', 'standard', 'deep'].includes(depth)) {
    res.status(400).json({ error: `Invalid depth: ${depth}. Use quick|standard|deep.` });
    return;
  }

  console.log(`[${new Date().toISOString()}] research: "${query}" (${depth})`);

  try {
    const record = await research({
      query: query.trim(),
      depth,
      onProgress: (e) => console.log(`  [${e.phase}] ${e.message}`),
    });

    try {
      const rel = getResearchStore().save(record);
      console.log(`  saved: ${rel}`);
    } catch (err) {
      console.error('  persistence failed:', err);
    }

    res.json({ success: true, ...record });
  } catch (err) {
    console.error('Research failed:', err);
    res.status(500).json({
      error: 'Research failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post('/research/stream', async (req, res): Promise<void> => {
  const { query, depth = 'standard' } = (req.body || {}) as ResearchRequest;

  if (!query || query.trim().length < 3) {
    res.status(400).json({ error: 'A research question (>=3 chars) is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const record = await research({
      query: query.trim(),
      depth,
      onProgress: (e) => send('progress', e),
    });
    try {
      getResearchStore().save(record);
    } catch (err) {
      send('warn', { message: 'persist failed', detail: String(err) });
    }
    send('result', record);
    res.end();
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
});

app.get('/researches', (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    res.json({ success: true, researches: getResearchStore().list(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list', message: String(err) });
  }
});

app.get('/research/:id', (req, res) => {
  const rec = getResearchStore().get(req.params.id);
  if (!rec) {
    res.status(404).json({ error: 'Not found', id: req.params.id });
    return;
  }
  res.json({ success: true, ...rec });
});

const PORT = CONFIG.server.port;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║   Mike the Researcher — AI research assistant            ║
║   API on http://localhost:${PORT}                              ║
╚═══════════════════════════════════════════════════════════╝

  Endpoints:
    GET  /health                  health check
    POST /research                run research (auto-persists)
    POST /research/stream         same, SSE progress
    GET  /researches?limit=50     list past research
    GET  /research/:id            full record

  Example:
    curl -X POST http://localhost:${PORT}/research \\
      -H "Content-Type: application/json" \\
      -d '{"query": "what is retrieval-augmented generation?", "depth": "standard"}'
`);
});

export default app;
