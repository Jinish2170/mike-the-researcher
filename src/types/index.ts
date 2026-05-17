// Mike the Researcher - Core Types

export type ResearchDepth = 'quick' | 'standard' | 'deep';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
  source: 'duckduckgo' | 'tavily';
}

export interface Source {
  id: number;                // citation number (1-based)
  url: string;
  title: string;
  domain: string;
  snippet: string;
  extractedText?: string;    // post-extraction main content
  charCount: number;
  fetchedAt: string;
  status: 'ok' | 'failed' | 'skipped';
  failureReason?: string;
}

export interface Citation {
  sourceId: number;
  quote?: string;
}

export interface ResearchBrief {
  summary: string;            // 2-4 paragraphs
  keyPoints: string[];        // bullet highlights
  followUpQuestions: string[];
  confidence: 'low' | 'medium' | 'high';
  reasoning?: string;         // why this confidence
}

export interface ResearchRecord {
  id: string;
  query: string;
  depth: ResearchDepth;
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

export interface ResearchSummary {
  id: string;
  query: string;
  depth: ResearchDepth;
  createdAt: string;
  stats: ResearchRecord['stats'];
  oneLine: string;            // first sentence of summary
}

export interface ProgressEvent {
  phase: 'search' | 'fetch' | 'extract' | 'synthesize' | 'done' | 'error';
  message: string;
  detail?: unknown;
}

export type ProgressHandler = (event: ProgressEvent) => void;
