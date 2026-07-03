// Wikipedia-specific extractor — pulls structured sections, infobox data, and references.
// Uses the MediaWiki API for clean text instead of HTML scraping.

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { CONFIG } from '../config';
import { ExtractedPage } from './readability';

interface WikiSection {
  title: string;
  level: number;
  content: string;
}

function extractArticleTitle(url: string): string | null {
  const match = url.match(/wikipedia\.org\/wiki\/([^#?]+)/i);
  return match ? decodeURIComponent(match[1].replace(/_/g, ' ')) : null;
}

async function fetchWikiText(title: string, lang = 'en'): Promise<{ text: string; sections: WikiSection[]; refs: string[] } | null> {
  try {
    const response = await axios.get(`https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': CONFIG.search.userAgent, Accept: 'text/html' },
      timeout: CONFIG.search.requestTimeoutMs,
    });

    const dom = new JSDOM(response.data, { url: `https://${lang}.wikipedia.org/wiki/${title}` });
    const doc = dom.window.document;

    // Extract sections
    const sections: WikiSection[] = [];
    const headings = doc.querySelectorAll('h2, h3, h4');
    headings.forEach((h) => {
      const id = h.id || h.textContent?.trim() || '';
      const level = parseInt(h.tagName.slice(1));
      let content = '';
      let sibling = h.nextElementSibling;
      while (sibling && !['H2', 'H3', 'H4'].includes(sibling.tagName)) {
        if (sibling.tagName === 'P' || sibling.tagName === 'UL' || sibling.tagName === 'OL') {
          content += (sibling.textContent || '').trim() + '\n';
        }
        sibling = sibling.nextElementSibling;
      }
      if (content.trim()) {
        sections.push({ title: id, level, content: content.trim() });
      }
    });

    // Extract references
    const refs: string[] = [];
    const refLinks = doc.querySelectorAll('.reference a[href^="http"], .reflist a[href^="http"]');
    refLinks.forEach((a) => {
      const href = a.getAttribute('href');
      if (href && !href.includes('wikipedia.org')) refs.push(href);
    });

    // Use Readability for the main text
    const reader = new Readability(doc);
    const article = reader.parse();
    const fullText = article?.textContent?.replace(/\s+/g, ' ').trim() || '';

    return { text: fullText, sections, refs: [...new Set(refs)].slice(0, 20) };
  } catch {
    return null;
  }
}

export async function extractWikipedia(url: string, _query: string): Promise<ExtractedPage> {
  const title = extractArticleTitle(url);
  if (!title) throw new Error(`Could not parse Wikipedia article title from ${url}`);

  const lang = url.match(/\/\/(\w+)\.wikipedia/)?.[1] || 'en';
  const wiki = await fetchWikiText(title, lang);

  if (!wiki || !wiki.text) throw new Error(`Wikipedia API returned no content for "${title}"`);

  // Build structured output with section headers
  const structuredParts: string[] = [];

  if (wiki.sections.length > 0) {
    const skipSections = /references|see[_ ]also|external[_ ]links|further[_ ]reading|notes|bibliography/i;
    for (const sec of wiki.sections) {
      if (skipSections.test(sec.title)) continue;
      structuredParts.push(`## ${sec.title}\n${sec.content}`);
    }
  }

  const structuredText = structuredParts.length > 0
    ? structuredParts.join('\n\n')
    : wiki.text;

  const refNote = wiki.refs.length > 0
    ? `\n\n[Referenced sources: ${wiki.refs.slice(0, 5).join(', ')}]`
    : '';

  const content = structuredText.slice(0, CONFIG.search.maxContentChars - refNote.length) + refNote;

  return {
    url,
    title: title.replace(/_/g, ' '),
    textContent: content,
    excerpt: wiki.text.slice(0, 200),
    siteName: 'Wikipedia',
    length: wiki.text.length,
  };
}
