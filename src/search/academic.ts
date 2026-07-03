import axios from 'axios';
import { SearchResult } from '../types';
import { CONFIG } from '../config';

const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1/paper/search';

interface S2Paper {
  paperId: string;
  title: string;
  abstract: string | null;
  url: string;
  year: number | null;
  citationCount: number;
  isOpenAccess: boolean;
  openAccessPdf: { url: string } | null;
  authors: { name: string }[];
}

export async function searchSemanticScholar(query: string, limit = 5): Promise<SearchResult[]> {
  try {
    const response = await axios.get<{ data: S2Paper[] }>(SEMANTIC_SCHOLAR_API, {
      params: {
        query,
        limit,
        fields: 'paperId,title,abstract,url,year,citationCount,isOpenAccess,openAccessPdf,authors',
      },
      timeout: CONFIG.search.requestTimeoutMs,
      headers: { 'User-Agent': CONFIG.search.userAgent },
    });

    const papers = response.data?.data || [];
    return papers.map((p, idx) => ({
      title: p.title,
      url: p.openAccessPdf?.url || p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
      snippet: p.abstract
        ? `${p.abstract.slice(0, 300)}${p.abstract.length > 300 ? '...' : ''}`
        : `${p.authors.map((a) => a.name).join(', ')} (${p.year || 'n.d.'}) — ${p.citationCount} citations`,
      rank: idx + 1,
      source: 'duckduckgo' as const,
    }));
  } catch {
    return [];
  }
}
