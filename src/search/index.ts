import { SearchResult } from '../types';
import { CONFIG } from '../config';
import { searchDuckDuckGo } from './duckduckgo';
import { searchTavily } from './tavily';

export async function searchWeb(query: string, limit = 10): Promise<SearchResult[]> {
  // Prefer Tavily if configured; fall back to DuckDuckGo.
  if (CONFIG.search.tavilyApiKey) {
    try {
      return await searchTavily(query, limit);
    } catch (err) {
      console.warn('Tavily search failed, falling back to DuckDuckGo:', err instanceof Error ? err.message : err);
    }
  }
  return searchDuckDuckGo(query, limit);
}

export { searchDuckDuckGo, searchTavily };
