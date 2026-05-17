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
    textContent: text.slice(0, CONFIG.search.maxContentChars),
    excerpt: article.excerpt || '',
    byline: article.byline || undefined,
    siteName: article.siteName || undefined,
    length: text.length,
  };
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
