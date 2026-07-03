import axios from 'axios';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../config';
import { ExtractedPage, selectRelevantContent } from './readability';

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url) || url.includes('/pdf/');
}

async function extractPdfViaGoogleViewer(url: string): Promise<string | null> {
  try {
    const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
    const resp = await axios.get(viewerUrl, {
      headers: { 'User-Agent': CONFIG.search.userAgent },
      timeout: CONFIG.search.requestTimeoutMs,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: (s) => s < 400,
    });

    const dom = new JSDOM(resp.data, { url: viewerUrl });
    const text = dom.window.document.body?.textContent?.trim();
    return text && text.length > 100 ? text : null;
  } catch {
    return null;
  }
}

async function extractPdfViaDirectDownload(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': CONFIG.search.userAgent },
      timeout: CONFIG.search.requestTimeoutMs * 2,
      responseType: 'arraybuffer',
      maxContentLength: 20 * 1024 * 1024,
      validateStatus: (s) => s < 400,
    });

    return {
      buffer: Buffer.from(resp.data),
      contentType: String(resp.headers['content-type'] || ''),
    };
  } catch {
    return null;
  }
}

function extractTextFromPdfBuffer(buffer: Buffer): string {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 1024 * 1024));

  const textParts: string[] = [];

  // Extract text between BT (begin text) and ET (end text) operators
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(text)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(tjMatch[1]);
    }

    // TJ operator with array
    const tjArrayRegex = /\[((?:\([^)]*\)|[^[\]])*)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
      const innerParts = tjArrMatch[1].match(/\(([^)]*)\)/g);
      if (innerParts) {
        textParts.push(innerParts.map((p) => p.slice(1, -1)).join(''));
      }
    }
  }

  // Decode PDF escape sequences
  return textParts
    .map((p) =>
      p
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromPdf(buffer: Buffer): string | null {
  const header = buffer.toString('utf8', 0, Math.min(buffer.length, 50000));
  const titleMatch = header.match(/\/Title\s*\(([^)]+)\)/);
  return titleMatch ? titleMatch[1] : null;
}

export async function extractPdf(url: string, query: string): Promise<ExtractedPage> {
  if (!isPdfUrl(url)) {
    throw new Error(`URL does not appear to be a PDF: ${url}`);
  }

  // Strategy 1: Try Google Docs viewer for rendered text
  const googleText = await extractPdfViaGoogleViewer(url);
  if (googleText && googleText.length > 200) {
    return {
      url,
      title: extractTitleFromUrl(url),
      textContent: selectRelevantContent(googleText, query, CONFIG.search.maxContentChars),
      excerpt: googleText.slice(0, 200),
      siteName: 'PDF Document',
      length: googleText.length,
    };
  }

  // Strategy 2: Download and parse PDF binary
  const download = await extractPdfViaDirectDownload(url);
  if (download) {
    const pdfTitle = extractTitleFromPdf(download.buffer);
    const pdfText = extractTextFromPdfBuffer(download.buffer);

    if (pdfText.length > 100) {
      return {
        url,
        title: pdfTitle || extractTitleFromUrl(url),
        textContent: selectRelevantContent(pdfText, query, CONFIG.search.maxContentChars),
        excerpt: pdfText.slice(0, 200),
        siteName: 'PDF Document',
        length: pdfText.length,
      };
    }
  }

  throw new Error(`Could not extract text from PDF: ${url}`);
}

function extractTitleFromUrl(url: string): string {
  const filename = url.split('/').pop()?.split('?')[0] || 'document';
  return decodeURIComponent(filename).replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
}
