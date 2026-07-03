import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { CONFIG } from '../config';
import { ExtractedPage, selectRelevantContent } from './readability';

interface TableData {
  headers: string[];
  rows: string[][];
  caption?: string;
}

interface StructuredContent {
  tables: TableData[];
  lists: string[];
  stats: string[];
  text: string;
}

function extractTables(doc: Document): TableData[] {
  const tables: TableData[] = [];

  doc.querySelectorAll('table').forEach((table) => {
    const caption = table.querySelector('caption')?.textContent?.trim();

    const headers: string[] = [];
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach((cell) => {
        headers.push((cell.textContent || '').trim());
      });
    }

    const rows: string[][] = [];
    const bodyRows = table.querySelectorAll('tbody tr, tr');
    bodyRows.forEach((tr, idx) => {
      if (idx === 0 && headers.length > 0 && !table.querySelector('thead')) return;
      const cells: string[] = [];
      tr.querySelectorAll('td, th').forEach((cell) => {
        cells.push((cell.textContent || '').trim());
      });
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    });

    if (rows.length > 0) {
      tables.push({ headers, rows, caption });
    }
  });

  return tables;
}

function extractLists(doc: Document): string[] {
  const lists: string[] = [];

  doc.querySelectorAll('main ul, main ol, article ul, article ol, .content ul, .content ol').forEach((list) => {
    const items: string[] = [];
    list.querySelectorAll(':scope > li').forEach((li) => {
      const text = (li.textContent || '').trim();
      if (text.length > 10 && text.length < 500) items.push(`• ${text}`);
    });
    if (items.length >= 2) {
      lists.push(items.join('\n'));
    }
  });

  return lists;
}

function extractStatistics(doc: Document): string[] {
  const stats: string[] = [];
  const statPattern = /\b\d[\d,.]*\s*(%|percent|billion|million|thousand|trillion|USD|EUR|GBP)\b/gi;

  doc.querySelectorAll('p, td, li, span, div').forEach((el) => {
    const text = (el.textContent || '').trim();
    if (text.length > 10 && text.length < 300) {
      const matches = text.match(statPattern);
      if (matches && matches.length > 0) {
        stats.push(text);
      }
    }
  });

  return [...new Set(stats)].slice(0, 20);
}

function formatTable(table: TableData): string {
  const parts: string[] = [];
  if (table.caption) parts.push(`Table: ${table.caption}`);

  if (table.headers.length > 0) {
    parts.push(table.headers.join(' | '));
    parts.push(table.headers.map(() => '---').join(' | '));
  }

  const maxRows = 30;
  const displayed = table.rows.slice(0, maxRows);
  for (const row of displayed) {
    parts.push(row.join(' | '));
  }

  if (table.rows.length > maxRows) {
    parts.push(`... and ${table.rows.length - maxRows} more rows`);
  }

  return parts.join('\n');
}

export async function extractStructuredData(url: string, query: string): Promise<ExtractedPage> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: CONFIG.search.requestTimeoutMs,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: (s) => s < 400,
  });

  const dom = new JSDOM(response.data, { url });
  const doc = dom.window.document;

  const structured: StructuredContent = {
    tables: extractTables(doc),
    lists: extractLists(doc),
    stats: extractStatistics(doc),
    text: '',
  };

  // Also get readable text via Readability
  const readableDom = new JSDOM(response.data, { url });
  const reader = new Readability(readableDom.window.document);
  const article = reader.parse();
  structured.text = article?.textContent?.replace(/\s+/g, ' ').trim() || '';

  // Build output prioritizing structured content
  const outputParts: string[] = [];

  if (structured.tables.length > 0) {
    outputParts.push('## Structured Data\n');
    for (const table of structured.tables.slice(0, 5)) {
      outputParts.push(formatTable(table));
      outputParts.push('');
    }
  }

  if (structured.stats.length > 0) {
    outputParts.push('## Key Statistics');
    for (const stat of structured.stats.slice(0, 10)) {
      outputParts.push(`• ${stat}`);
    }
    outputParts.push('');
  }

  if (structured.lists.length > 0) {
    outputParts.push('## Key Lists');
    for (const list of structured.lists.slice(0, 5)) {
      outputParts.push(list);
      outputParts.push('');
    }
  }

  if (structured.text) {
    outputParts.push('## Article Content');
    outputParts.push(structured.text);
  }

  const fullText = outputParts.join('\n');
  if (!fullText.trim()) {
    throw new Error(`Could not extract structured content from ${url}`);
  }

  return {
    url,
    title: article?.title || url,
    textContent: selectRelevantContent(fullText, query, CONFIG.search.maxContentChars),
    excerpt: (article?.excerpt || structured.stats[0] || '').slice(0, 200),
    siteName: article?.siteName || undefined,
    length: fullText.length,
  };
}
