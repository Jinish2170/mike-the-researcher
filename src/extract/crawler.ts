import axios from 'axios';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../config';
import { ExtractedPage, extractPage, domainOf } from './readability';
import { fetchWithRetry } from './retry';

interface CrawlResult {
  sourceUrl: string;
  referencedUrls: string[];
  followed: ExtractedPage[];
}

const SKIP_EXTENSIONS = /\.(pdf|zip|tar|gz|mp4|mp3|wav|avi|mov|png|jpg|jpeg|gif|svg|ico|woff|ttf|eot)$/i;
const SKIP_DOMAINS = /\b(facebook|twitter|instagram|tiktok|youtube|linkedin|reddit|t\.co|bit\.ly|goo\.gl)\b/i;

function isFollowableLink(href: string, sourceDomain: string): boolean {
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (SKIP_EXTENSIONS.test(url.pathname)) return false;
    if (SKIP_DOMAINS.test(url.hostname)) return false;
    if (url.hostname === sourceDomain) return false;
    if (url.pathname === '/' || url.pathname === '') return false;
    return true;
  } catch {
    return false;
  }
}

function extractOutboundLinks(html: string, sourceUrl: string, maxLinks: number): string[] {
  const dom = new JSDOM(html, { url: sourceUrl });
  const doc = dom.window.document;
  const sourceDomain = domainOf(sourceUrl);
  const seen = new Set<string>();
  const links: string[] = [];

  const contentArea = doc.querySelector('article, main, .content, .post-body, .entry-content, #content')
    || doc.body;

  contentArea.querySelectorAll('a[href]').forEach((a) => {
    if (links.length >= maxLinks) return;
    const href = a.getAttribute('href');
    if (!href) return;

    try {
      const resolved = new URL(href, sourceUrl).toString().split('#')[0];
      if (!seen.has(resolved) && isFollowableLink(resolved, sourceDomain)) {
        seen.add(resolved);
        links.push(resolved);
      }
    } catch {
      // invalid URL
    }
  });

  return links;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': CONFIG.search.userAgent,
        Accept: 'text/html',
      },
      timeout: CONFIG.search.requestTimeoutMs,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: (s) => s < 400,
      maxRedirects: 3,
    });
    return typeof resp.data === 'string' ? resp.data : null;
  } catch {
    return null;
  }
}

export async function crawlReferences(
  sourceUrl: string,
  _query: string,
  options: { maxFollow?: number; maxDepth?: number } = {}
): Promise<CrawlResult> {
  const maxFollow = options.maxFollow || 3;
  const result: CrawlResult = {
    sourceUrl,
    referencedUrls: [],
    followed: [],
  };

  const html = await fetchHtml(sourceUrl);
  if (!html) return result;

  const links = extractOutboundLinks(html, sourceUrl, maxFollow * 3);
  result.referencedUrls = links;

  const toFollow = links.slice(0, maxFollow);

  const followTasks = toFollow.map(async (link) => {
    try {
      const page = await fetchWithRetry(
        () => extractPage(link),
        { maxRetries: 1, baseDelayMs: 500 }
      );
      return page;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(followTasks);
  result.followed = results.filter((r): r is ExtractedPage => r !== null);

  return result;
}

export async function discoverRelatedUrls(
  sourceUrls: string[],
  maxPerSource = 3
): Promise<string[]> {
  const allLinks = new Set<string>();
  const sourceDomains = new Set(sourceUrls.map(domainOf));

  const tasks = sourceUrls.slice(0, 5).map(async (url) => {
    const html = await fetchHtml(url);
    if (!html) return;
    const links = extractOutboundLinks(html, url, maxPerSource * 2);
    for (const link of links.slice(0, maxPerSource)) {
      if (!sourceDomains.has(domainOf(link))) {
        allLinks.add(link);
      }
    }
  });

  await Promise.all(tasks);
  return [...allLinks];
}
