// Tavily Search API backend — optional, higher-quality results with API key.
// https://tavily.com — free tier available
import axios from 'axios';
import { SearchResult } from '../types';
import { CONFIG } from '../config';

export async function searchTavily(query: string, limit = 10): Promise<SearchResult[]> {
  if (!CONFIG.search.tavilyApiKey) {
    throw new Error('TAVILY_API_KEY not set');
  }

  const response = await axios.post(
    'https://api.tavily.com/search',
    {
      api_key: CONFIG.search.tavilyApiKey,
      query,
      search_depth: 'basic',
      max_results: limit,
      include_answer: false,
      include_raw_content: false,
    },
    {
      timeout: CONFIG.search.requestTimeoutMs,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const items = response.data?.results || [];
  return items.slice(0, limit).map((item: any, idx: number) => ({
    title: item.title || '',
    url: item.url,
    snippet: item.content || '',
    rank: idx + 1,
    source: 'tavily' as const,
  }));
}
