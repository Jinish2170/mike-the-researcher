import axios from 'axios';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../config';
import { ExtractedPage } from './readability';

interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  pdfUrl: string;
  htmlUrl: string;
  commentText?: string;
}

function extractArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return match ? match[1] : null;
}

async function fetchArxivMetadata(arxivId: string): Promise<ArxivPaper | null> {
  try {
    const apiUrl = `http://export.arxiv.org/api/query?id_list=${arxivId}`;
    const resp = await axios.get(apiUrl, {
      headers: { 'User-Agent': CONFIG.search.userAgent },
      timeout: CONFIG.search.requestTimeoutMs,
      responseType: 'text',
    });

    const dom = new JSDOM(resp.data, { contentType: 'text/xml' });
    const doc = dom.window.document;

    const entry = doc.querySelector('entry');
    if (!entry) return null;

    const getText = (tag: string) => entry.querySelector(tag)?.textContent?.trim() || '';

    const authors: string[] = [];
    entry.querySelectorAll('author name').forEach((el) => {
      const name = el.textContent?.trim();
      if (name) authors.push(name);
    });

    const categories: string[] = [];
    entry.querySelectorAll('category').forEach((el) => {
      const term = el.getAttribute('term');
      if (term) categories.push(term);
    });

    const baseId = arxivId.replace(/v\d+$/, '');

    return {
      id: baseId,
      title: getText('title').replace(/\s+/g, ' '),
      authors,
      abstract: getText('summary').replace(/\s+/g, ' '),
      published: getText('published'),
      updated: getText('updated'),
      categories,
      pdfUrl: `https://arxiv.org/pdf/${baseId}`,
      htmlUrl: `https://arxiv.org/html/${baseId}`,
      commentText: getText('comment') || undefined,
    };
  } catch {
    return null;
  }
}

async function fetchArxivHtml(arxivId: string): Promise<string | null> {
  try {
    const htmlUrl = `https://arxiv.org/html/${arxivId.replace(/v\d+$/, '')}`;
    const resp = await axios.get(htmlUrl, {
      headers: {
        'User-Agent': CONFIG.search.userAgent,
        Accept: 'text/html',
      },
      timeout: CONFIG.search.requestTimeoutMs,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: (s) => s < 400,
    });

    const dom = new JSDOM(resp.data, { url: htmlUrl });
    const doc = dom.window.document;

    const sections: string[] = [];
    const sectionEls = doc.querySelectorAll('.ltx_section, .ltx_subsection, section');

    sectionEls.forEach((sec) => {
      const heading = sec.querySelector('h2, h3, h4, .ltx_title');
      const headingText = heading?.textContent?.trim() || '';

      const paragraphs: string[] = [];
      sec.querySelectorAll('p, .ltx_para').forEach((p) => {
        const text = p.textContent?.trim();
        if (text && text.length > 20) paragraphs.push(text);
      });

      if (paragraphs.length > 0) {
        const label = headingText ? `## ${headingText}` : '';
        sections.push([label, ...paragraphs].filter(Boolean).join('\n'));
      }
    });

    return sections.length > 0 ? sections.join('\n\n') : null;
  } catch {
    return null;
  }
}

export async function extractArxivPaper(url: string, _query: string): Promise<ExtractedPage> {
  const arxivId = extractArxivId(url);
  if (!arxivId) throw new Error(`Could not parse arXiv ID from ${url}`);

  const paper = await fetchArxivMetadata(arxivId);
  if (!paper) throw new Error(`arXiv API returned no data for ${arxivId}`);

  const parts: string[] = [];
  parts.push(`# ${paper.title}`);
  parts.push(`Authors: ${paper.authors.join(', ')}`);
  parts.push(`Published: ${paper.published.slice(0, 10)}`);
  if (paper.categories.length) parts.push(`Categories: ${paper.categories.join(', ')}`);
  if (paper.commentText) parts.push(`Comment: ${paper.commentText}`);
  parts.push('');
  parts.push(`## Abstract\n${paper.abstract}`);

  // Try to get the full HTML paper body
  const htmlContent = await fetchArxivHtml(arxivId);
  if (htmlContent) {
    parts.push('');
    parts.push(htmlContent);
  }

  parts.push('');
  parts.push(`[PDF: ${paper.pdfUrl}]`);

  const fullText = parts.join('\n');
  const content = fullText.slice(0, CONFIG.search.maxContentChars);

  return {
    url,
    title: paper.title,
    textContent: content,
    excerpt: paper.abstract.slice(0, 200),
    siteName: 'arXiv',
    byline: paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : ''),
    length: fullText.length,
  };
}
