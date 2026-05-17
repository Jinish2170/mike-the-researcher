// DuckDuckGo HTML search backend — no API key required.
// Uses the lite HTML endpoint and parses the returned anchor tags.
import axios from 'axios';
import { SearchResult } from '../types';
import { CONFIG } from '../config';

const DDG_URL = 'https://html.duckduckgo.com/html/';

export async function searchDuckDuckGo(query: string, limit = 10): Promise<SearchResult[]> {
  const response = await axios.post(
    DDG_URL,
    new URLSearchParams({ q: query }).toString(),
    {
      headers: {
        'User-Agent': CONFIG.search.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: CONFIG.search.requestTimeoutMs,
      validateStatus: (s) => s < 500,
    }
  );

  if (typeof response.data !== 'string') return [];
  return parseDdgHtml(response.data, limit);
}

// Parse the DDG HTML lite response. We don't pull in a full HTML parser for this —
// the structure is stable and a careful regex pass keeps deps small.
function parseDdgHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  let rank = 1;
  while ((match = resultPattern.exec(html)) !== null) {
    const rawHref = decodeHtml(match[1]);
    const title = stripHtml(match[2]).trim();
    const snippet = stripHtml(match[4]).trim();
    const url = unwrapDdgRedirect(rawHref);
    if (!url || !title) continue;

    results.push({ title, url, snippet, rank: rank++, source: 'duckduckgo' });
    if (results.length >= limit) break;
  }
  return results;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// DDG wraps outbound links in /l/?uddg=<encoded>
function unwrapDdgRedirect(href: string): string | null {
  try {
    if (href.startsWith('//')) href = 'https:' + href;
    if (href.startsWith('/')) href = 'https://html.duckduckgo.com' + href;
    const u = new URL(href);
    const target = u.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : href;
  } catch {
    return null;
  }
}
