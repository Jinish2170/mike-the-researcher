import { SearchResult } from '../types';

export type SourceCategory = 'academic' | 'news' | 'official' | 'blog' | 'reference' | 'other';

export interface ScoredResult extends SearchResult {
  qualityScore: number;
  category: SourceCategory;
}

const DOMAIN_AUTHORITY: Record<string, number> = {
  'arxiv.org': 0.4, 'scholar.google.com': 0.4, 'pubmed.ncbi.nlm.nih.gov': 0.4,
  'nature.com': 0.4, 'science.org': 0.4, 'ieee.org': 0.38,
  'acm.org': 0.38, 'springer.com': 0.35, 'sciencedirect.com': 0.35,
  'wikipedia.org': 0.3, 'britannica.com': 0.3, 'stackoverflow.com': 0.28,
  'nytimes.com': 0.3, 'bbc.com': 0.3, 'bbc.co.uk': 0.3,
  'reuters.com': 0.3, 'theguardian.com': 0.28, 'washingtonpost.com': 0.28,
  'apnews.com': 0.3, 'cnn.com': 0.25, 'techcrunch.com': 0.25,
  'arstechnica.com': 0.28, 'wired.com': 0.25, 'theverge.com': 0.23,
  'github.com': 0.22, 'docs.python.org': 0.35, 'developer.mozilla.org': 0.35,
  'ibm.com': 0.25, 'microsoft.com': 0.25, 'cloud.google.com': 0.25,
  'aws.amazon.com': 0.25, 'openai.com': 0.25,
  'medium.com': 0.12, 'dev.to': 0.12, 'hashnode.dev': 0.1,
  'towardsdatascience.com': 0.18, 'huggingface.co': 0.25,
};

const LOW_QUALITY_PATTERNS = [
  /twitter\.com/i, /x\.com/i, /facebook\.com/i, /instagram\.com/i,
  /tiktok\.com/i, /pinterest\.com/i, /linkedin\.com\/posts/i,
  /youtube\.com/i, /vimeo\.com/i, /dailymotion\.com/i,
  /login|signup|sign-in|register|cart|checkout|subscribe/i,
  /\.pdf$/i,
];

const CATEGORY_PATTERNS: [RegExp, SourceCategory][] = [
  [/\.edu(\/|$)/i, 'academic'],
  [/arxiv\.org|scholar\.google|pubmed|ncbi|ieee\.org|acm\.org|nature\.com|science\.org|springer|sciencedirect/i, 'academic'],
  [/nytimes|bbc\.|reuters|theguardian|washingtonpost|apnews|cnn\.com|bloomberg|economist/i, 'news'],
  [/\.gov(\/|$)/i, 'official'],
  [/docs\.|developer\.|documentation|official/i, 'official'],
  [/wikipedia|britannica|stackoverflow|stackexchange/i, 'reference'],
  [/medium\.com|dev\.to|hashnode|blog|substack|wordpress/i, 'blog'],
];

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function domainAuthority(url: string): number {
  const domain = getDomain(url);
  for (const [key, score] of Object.entries(DOMAIN_AUTHORITY)) {
    if (domain === key || domain.endsWith('.' + key)) return score;
  }
  if (domain.endsWith('.edu')) return 0.35;
  if (domain.endsWith('.gov')) return 0.32;
  if (domain.endsWith('.org')) return 0.15;
  return 0.08;
}

function snippetRelevance(snippet: string, query: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (queryTerms.length === 0) return 0.15;
  const snippetLower = snippet.toLowerCase();
  const matches = queryTerms.filter((t) => snippetLower.includes(t)).length;
  return 0.3 * (matches / queryTerms.length);
}

function rankScore(rank: number, total: number): number {
  return 0.3 * Math.max(0, 1 - (rank - 1) / Math.max(total, 1));
}

export function categorizeUrl(url: string): SourceCategory {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(url)) return category;
  }
  return 'other';
}

export function filterLowQualityUrls(results: SearchResult[]): SearchResult[] {
  return results.filter((r) => {
    return !LOW_QUALITY_PATTERNS.some((p) => p.test(r.url));
  });
}

export function scoreAndRankResults(results: SearchResult[], query: string): ScoredResult[] {
  const total = results.length;
  return results
    .map((r) => ({
      ...r,
      qualityScore: domainAuthority(r.url) + snippetRelevance(r.snippet, query) + rankScore(r.rank, total),
      category: categorizeUrl(r.url),
    }))
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

export function enforceSourceDiversity(results: ScoredResult[], maxPerCategory: number): ScoredResult[] {
  const counts = new Map<SourceCategory, number>();
  return results.filter((r) => {
    const c = counts.get(r.category) || 0;
    if (c >= maxPerCategory) return false;
    counts.set(r.category, c + 1);
    return true;
  });
}
