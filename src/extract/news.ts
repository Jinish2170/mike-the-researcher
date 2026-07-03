import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { CONFIG } from '../config';
import { ExtractedPage, selectRelevantContent } from './readability';
import { extractPageMetadata, formatMetadataAsContext } from './jsonld';

const NEWS_DOMAINS = new Set([
  'nytimes.com', 'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'reuters.com',
  'apnews.com', 'cnn.com', 'theguardian.com', 'npr.org', 'wsj.com',
  'bloomberg.com', 'forbes.com', 'cnbc.com', 'arstechnica.com', 'wired.com',
  'techcrunch.com', 'theverge.com', 'vice.com', 'vox.com', 'politico.com',
  'thehill.com', 'axios.com', 'ft.com', 'economist.com', 'nature.com',
  'sciencemag.org', 'newscientist.com', 'time.com', 'newsweek.com',
]);

export function isNewsUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return NEWS_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

function extractArticleDate(doc: Document): string | null {
  // Try multiple date sources
  const selectors = [
    'time[datetime]',
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publish_date"]',
    '.date', '.published', '.article-date', '.post-date',
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const value = el.getAttribute('datetime')
      || el.getAttribute('content')
      || el.textContent?.trim();
    if (value && value.length > 4) return value;
  }
  return null;
}

function extractByline(doc: Document): string | null {
  const selectors = [
    '.author', '.byline', '[rel="author"]', '.article-author',
    'meta[name="author"]', 'meta[property="article:author"]',
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const value = el.getAttribute('content') || el.textContent?.trim();
    if (value && value.length > 1 && value.length < 200) return value;
  }
  return null;
}

function extractPublisher(doc: Document): string | null {
  const ogSite = doc.querySelector('meta[property="og:site_name"]');
  if (ogSite) return ogSite.getAttribute('content');

  const publisher = doc.querySelector('meta[name="publisher"]');
  if (publisher) return publisher.getAttribute('content');

  return null;
}

function cleanNewsContent(text: string): string {
  return text
    .replace(/Advertisement\s*/gi, '')
    .replace(/Subscribe to .*?\n/gi, '')
    .replace(/Sign up for .*?\n/gi, '')
    .replace(/Read more:.*?\n/gi, '')
    .replace(/Related:.*?\n/gi, '')
    .replace(/\[.*?Getty Images.*?\]/gi, '')
    .replace(/\[.*?AP Photo.*?\]/gi, '')
    .replace(/Photo:.*?\n/gi, '')
    .replace(/Credit:.*?\n/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractNewsArticle(url: string, query: string): Promise<ExtractedPage> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: CONFIG.search.requestTimeoutMs,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: (s) => s < 400,
    maxRedirects: 5,
  });

  const dom = new JSDOM(response.data, { url });
  const doc = dom.window.document;

  const date = extractArticleDate(doc);
  const byline = extractByline(doc);
  const publisher = extractPublisher(doc);

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article?.textContent) {
    throw new Error(`Could not extract news article from ${url}`);
  }

  const cleanedText = cleanNewsContent(article.textContent.replace(/\s+/g, ' ').trim());

  // Try to get rich metadata
  let metadataContext = '';
  try {
    const meta = await extractPageMetadata(url);
    metadataContext = formatMetadataAsContext(meta);
  } catch {
    // metadata enrichment is optional
  }

  // Build enriched output
  const parts: string[] = [];
  parts.push(`# ${article.title}`);

  const contextLine: string[] = [];
  if (publisher || article.siteName) contextLine.push(publisher || article.siteName || '');
  if (byline || article.byline) contextLine.push(`By ${byline || article.byline}`);
  if (date) contextLine.push(date);
  if (contextLine.length) parts.push(contextLine.join(' | '));

  parts.push('');
  if (metadataContext) {
    parts.push(metadataContext);
    parts.push('');
  }
  parts.push(cleanedText);

  const fullText = parts.join('\n');

  return {
    url,
    title: article.title,
    textContent: selectRelevantContent(fullText, query, CONFIG.search.maxContentChars),
    excerpt: article.excerpt || cleanedText.slice(0, 200),
    byline: byline || article.byline || undefined,
    siteName: publisher || article.siteName || undefined,
    length: fullText.length,
  };
}
