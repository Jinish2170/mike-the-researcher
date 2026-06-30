import axios from 'axios';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../config';

export interface PageMetadata {
  title?: string;
  description?: string;
  author?: string;
  datePublished?: string;
  dateModified?: string;
  publisher?: string;
  type?: string;
  image?: string;
  keywords?: string[];
  breadcrumbs?: string[];
  rating?: { value: number; count: number };
  faq?: { question: string; answer: string }[];
  howTo?: { name: string; steps: string[] };
  organization?: { name: string; url?: string };
}

function extractJsonLd(doc: Document): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const parsed = JSON.parse(el.textContent || '');
      if (Array.isArray(parsed)) results.push(...parsed);
      else if (parsed['@graph']) results.push(...parsed['@graph']);
      else results.push(parsed);
    } catch {
      // malformed JSON-LD
    }
  });
  return results;
}

function extractOpenGraph(doc: Document): Record<string, string> {
  const og: Record<string, string> = {};
  doc.querySelectorAll('meta[property^="og:"], meta[name^="og:"]').forEach((el) => {
    const prop = (el.getAttribute('property') || el.getAttribute('name') || '').replace('og:', '');
    const content = el.getAttribute('content') || '';
    if (prop && content) og[prop] = content;
  });
  return og;
}

function extractTwitterMeta(doc: Document): Record<string, string> {
  const tw: Record<string, string> = {};
  doc.querySelectorAll('meta[name^="twitter:"], meta[property^="twitter:"]').forEach((el) => {
    const name = (el.getAttribute('name') || el.getAttribute('property') || '').replace('twitter:', '');
    const content = el.getAttribute('content') || '';
    if (name && content) tw[name] = content;
  });
  return tw;
}

function extractStandardMeta(doc: Document): Record<string, string> {
  const meta: Record<string, string> = {};
  const names = ['description', 'author', 'keywords', 'date', 'article:published_time', 'article:modified_time'];
  for (const name of names) {
    const el = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    const content = el?.getAttribute('content');
    if (content) meta[name] = content;
  }
  return meta;
}

function parseJsonLdToMetadata(items: Record<string, unknown>[]): Partial<PageMetadata> {
  const result: Partial<PageMetadata> = {};

  for (const item of items) {
    const type = String(item['@type'] || '');

    if (['Article', 'NewsArticle', 'BlogPosting', 'ScholarlyArticle', 'TechArticle'].includes(type)) {
      result.title = result.title || String(item.headline || item.name || '');
      result.description = result.description || String(item.description || '');
      result.datePublished = result.datePublished || String(item.datePublished || '');
      result.dateModified = result.dateModified || String(item.dateModified || '');
      result.type = type;

      const author = item.author as Record<string, string> | Record<string, string>[];
      if (Array.isArray(author)) {
        result.author = author.map((a) => a.name || '').filter(Boolean).join(', ');
      } else if (author?.name) {
        result.author = author.name;
      }

      const publisher = item.publisher as Record<string, string> | undefined;
      if (publisher?.name) result.publisher = publisher.name;
    }

    if (type === 'FAQPage' && Array.isArray(item.mainEntity)) {
      result.faq = [];
      for (const entity of item.mainEntity as Record<string, unknown>[]) {
        const q = String(entity.name || '');
        const a = (entity.acceptedAnswer as Record<string, string>)?.text || '';
        if (q && a) result.faq.push({ question: q, answer: a });
      }
    }

    if (type === 'HowTo') {
      const steps: string[] = [];
      if (Array.isArray(item.step)) {
        for (const step of item.step as Record<string, string>[]) {
          steps.push(step.text || step.name || '');
        }
      }
      result.howTo = { name: String(item.name || ''), steps: steps.filter(Boolean) };
    }

    if (type === 'BreadcrumbList' && Array.isArray(item.itemListElement)) {
      result.breadcrumbs = (item.itemListElement as Record<string, unknown>[])
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
        .map((el) => String((el.item as Record<string, string>)?.name || el.name || ''))
        .filter(Boolean);
    }

    if (type === 'AggregateRating') {
      result.rating = {
        value: Number(item.ratingValue || 0),
        count: Number(item.reviewCount || item.ratingCount || 0),
      };
    }
  }

  return result;
}

export async function extractPageMetadata(url: string): Promise<PageMetadata> {
  const resp = await axios.get(url, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      Accept: 'text/html',
    },
    timeout: CONFIG.search.requestTimeoutMs,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: (s) => s < 400,
  });

  const dom = new JSDOM(resp.data, { url });
  const doc = dom.window.document;

  const jsonLd = extractJsonLd(doc);
  const og = extractOpenGraph(doc);
  const tw = extractTwitterMeta(doc);
  const standard = extractStandardMeta(doc);
  const ldMeta = parseJsonLdToMetadata(jsonLd);

  const metadata: PageMetadata = {
    title: ldMeta.title || og.title || tw.title || doc.title || undefined,
    description: ldMeta.description || og.description || tw.description || standard.description || undefined,
    author: ldMeta.author || standard.author || undefined,
    datePublished: ldMeta.datePublished || standard['article:published_time'] || standard.date || undefined,
    dateModified: ldMeta.dateModified || standard['article:modified_time'] || undefined,
    publisher: ldMeta.publisher || og.site_name || undefined,
    type: ldMeta.type || og.type || undefined,
    image: og.image || tw.image || undefined,
    keywords: standard.keywords?.split(',').map((k) => k.trim()).filter(Boolean),
    breadcrumbs: ldMeta.breadcrumbs,
    rating: ldMeta.rating,
    faq: ldMeta.faq,
    howTo: ldMeta.howTo,
    organization: ldMeta.organization,
  };

  return metadata;
}

export function formatMetadataAsContext(meta: PageMetadata): string {
  const parts: string[] = [];

  if (meta.author) parts.push(`Author: ${meta.author}`);
  if (meta.publisher) parts.push(`Publisher: ${meta.publisher}`);
  if (meta.datePublished) parts.push(`Published: ${meta.datePublished}`);
  if (meta.type) parts.push(`Type: ${meta.type}`);
  if (meta.keywords?.length) parts.push(`Keywords: ${meta.keywords.join(', ')}`);
  if (meta.breadcrumbs?.length) parts.push(`Category: ${meta.breadcrumbs.join(' > ')}`);
  if (meta.rating) parts.push(`Rating: ${meta.rating.value}/5 (${meta.rating.count} reviews)`);

  if (meta.faq && meta.faq.length > 0) {
    parts.push('\n## FAQ');
    for (const item of meta.faq) {
      parts.push(`Q: ${item.question}`);
      parts.push(`A: ${item.answer}\n`);
    }
  }

  if (meta.howTo) {
    parts.push(`\n## How To: ${meta.howTo.name}`);
    meta.howTo.steps.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
  }

  return parts.join('\n');
}
