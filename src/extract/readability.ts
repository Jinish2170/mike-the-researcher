// Extract main article content from a URL using Mozilla Readability.
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { CONFIG } from '../config';

export interface ExtractedPage {
  url: string;
  title: string;
  textContent: string;
  excerpt: string;
  byline?: string;
  siteName?: string;
  length: number;
}

export async function extractPage(url: string): Promise<ExtractedPage> {
  const response = await axios.get<string>(url, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
    },
    timeout: CONFIG.search.requestTimeoutMs,
    maxRedirects: 5,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: (s) => s < 400,
  });

  const finalUrl = response.request?.res?.responseUrl || url;
  const dom = new JSDOM(response.data, { url: finalUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent) {
    throw new Error('Could not extract main content (no readable article)');
  }

  const text = article.textContent.replace(/\s+/g, ' ').trim();
  return {
    url: finalUrl,
    title: article.title || finalUrl,
    textContent: selectRelevantContent(text, '', CONFIG.search.maxContentChars),
    excerpt: article.excerpt || '',
    byline: article.byline || undefined,
    siteName: article.siteName || undefined,
    length: text.length,
  };
}

export function selectRelevantContent(fullText: string, query: string, maxChars: number): string {
  if (fullText.length <= maxChars) return fullText;

  const paragraphs = fullText.split(/\n\n+|(?<=\.)\s{2,}/).filter((p) => p.trim().length > 20);

  if (paragraphs.length <= 3) return fullText.slice(0, maxChars);

  if (!query || query.trim().length === 0) return fullText.slice(0, maxChars);

  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const scored = paragraphs.map((p, idx) => {
    const lower = p.toLowerCase();
    const termMatches = queryTerms.filter((t) => lower.includes(t)).length;
    const relevance = queryTerms.length > 0 ? termMatches / queryTerms.length : 0;
    return { text: p, idx, relevance };
  });

  const selected: typeof scored = [];
  let budget = maxChars;

  // Always include first 2 paragraphs (introduction)
  for (const p of scored.slice(0, 2)) {
    selected.push(p);
    budget -= p.text.length;
  }

  // Always include last paragraph (conclusion) if space permits
  const last = scored[scored.length - 1];
  if (last.idx >= 2 && last.text.length < budget * 0.3) {
    selected.push(last);
    budget -= last.text.length;
  }

  // Fill remaining budget with highest-relevance paragraphs
  const remaining = scored
    .filter((p) => !selected.includes(p))
    .sort((a, b) => b.relevance - a.relevance);

  for (const p of remaining) {
    if (budget <= 0) break;
    if (p.text.length <= budget) {
      selected.push(p);
      budget -= p.text.length;
    }
  }

  // Return in original order
  return selected
    .sort((a, b) => a.idx - b.idx)
    .map((p) => p.text)
    .join('\n\n')
    .slice(0, maxChars);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
