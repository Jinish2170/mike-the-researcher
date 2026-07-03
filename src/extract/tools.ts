import { CONFIG } from '../config';
import { ExtractedPage, extractPage, domainOf, selectRelevantContent } from './readability';
import { extractStructuredData } from './structured';
import { extractGitHubContent } from './github';
import { extractWikipedia } from './wikipedia';
import { extractArxivPaper } from './arxiv';
import { extractYouTube } from './youtube';
import { extractReddit } from './reddit';
import { extractStackOverflow } from './stackoverflow';
import { extractPdf } from './pdf';
import { extractNewsArticle, isNewsUrl } from './news';
import { extractPageMetadata, formatMetadataAsContext } from './jsonld';
import { crawlReferences, discoverRelatedUrls } from './crawler';
import { computeFingerprint, deduplicateByContent, areSimilar } from './fingerprint';
import { Source } from '../types';

export interface ToolMatch {
  tool: string;
  confidence: number;
  extract: (url: string, query: string) => Promise<ExtractedPage>;
}

interface ToolRegistration {
  name: string;
  description: string;
  matchUrl: (url: string) => number;
  extract: (url: string, query: string) => Promise<ExtractedPage>;
}

const tools: ToolRegistration[] = [];

export function registerTool(tool: ToolRegistration): void {
  tools.push(tool);
}

export function matchTool(url: string): ToolMatch {
  let best: ToolMatch = {
    tool: 'readability',
    confidence: 0.3,
    extract: async (u, q) => {
      const page = await extractPage(u);
      page.textContent = selectRelevantContent(page.textContent, q, CONFIG.search.maxContentChars);
      return page;
    },
  };

  for (const t of tools) {
    const score = t.matchUrl(url);
    if (score > best.confidence) {
      best = { tool: t.name, confidence: score, extract: t.extract };
    }
  }

  return best;
}

export async function smartExtract(url: string, query: string): Promise<ExtractedPage & { toolUsed: string }> {
  const match = matchTool(url);
  try {
    const result = await match.extract(url, query);
    return { ...result, toolUsed: match.tool };
  } catch (primaryErr) {
    // If a specialized tool fails, fall back to generic readability
    if (match.tool !== 'readability') {
      try {
        const page = await extractPage(url);
        page.textContent = selectRelevantContent(page.textContent, query, CONFIG.search.maxContentChars);
        return { ...page, toolUsed: 'readability-fallback' };
      } catch {
        // Both failed — throw the original error
      }
    }
    throw primaryErr;
  }
}

export async function enrichWithMetadata(page: ExtractedPage): Promise<ExtractedPage> {
  try {
    const meta = await extractPageMetadata(page.url);
    const context = formatMetadataAsContext(meta);
    if (context) {
      page.textContent = `${context}\n\n---\n\n${page.textContent}`;
      if (meta.author && !page.byline) page.byline = meta.author;
      if (meta.publisher && !page.siteName) page.siteName = meta.publisher;
    }
  } catch {
    // enrichment is optional
  }
  return page;
}

export function deduplicateSources(sources: Source[]): { sources: Source[]; removed: number } {
  const result = deduplicateByContent(sources);
  return { sources: result.items, removed: result.duplicatesRemoved };
}

export function isContentDuplicate(text1: string, text2: string): boolean {
  return areSimilar(text1, text2);
}

export function getFingerprint(text: string): string {
  return computeFingerprint(text);
}

export { crawlReferences, discoverRelatedUrls } from './crawler';

export function listTools(): { name: string; description: string }[] {
  return [
    { name: 'readability', description: 'Generic article extraction via Mozilla Readability (default fallback)' },
    ...tools.map((t) => ({ name: t.name, description: t.description })),
  ];
}

// ── Register all built-in tools on module load ──────────────

registerTool({
  name: 'wikipedia',
  description: 'Extracts Wikipedia articles with structured sections, infoboxes, and reference links',
  matchUrl: (url) => /wikipedia\.org\/wiki\//i.test(url) ? 0.95 : 0,
  extract: extractWikipedia,
});

registerTool({
  name: 'github',
  description: 'Extracts GitHub repository READMEs, issues, pull requests, discussions, and code files via API',
  matchUrl: (url) => {
    if (/github\.com\/[^/]+\/[^/]+/i.test(url)) return 0.9;
    if (/github\.com/i.test(url)) return 0.6;
    return 0;
  },
  extract: extractGitHubContent,
});

registerTool({
  name: 'arxiv',
  description: 'Extracts arXiv paper abstracts, metadata, authors, categories, and HTML full text',
  matchUrl: (url) => /arxiv\.org\/(abs|pdf|html)\//i.test(url) ? 0.95 : 0,
  extract: extractArxivPaper,
});

registerTool({
  name: 'youtube',
  description: 'Extracts YouTube video metadata, descriptions, chapter markers, and transcripts',
  matchUrl: (url) => {
    if (/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(url)) return 0.95;
    if (/youtube\.com/i.test(url)) return 0.5;
    return 0;
  },
  extract: extractYouTube,
});

registerTool({
  name: 'reddit',
  description: 'Extracts Reddit posts with top-voted comment threads, scores, and discussion context',
  matchUrl: (url) => {
    if (/(?:reddit\.com|old\.reddit\.com)\/r\/[^/]+\/comments\//i.test(url)) return 0.95;
    if (/reddit\.com/i.test(url)) return 0.4;
    return 0;
  },
  extract: extractReddit,
});

registerTool({
  name: 'stackoverflow',
  description: 'Extracts StackOverflow/StackExchange Q&A with accepted answers, code blocks, and vote scores',
  matchUrl: (url) => {
    if (/stackoverflow\.com\/questions\/\d+/i.test(url)) return 0.95;
    if (/stackexchange\.com\/questions\/\d+/i.test(url)) return 0.95;
    if (/(?:serverfault|superuser|askubuntu)\.com\/questions\/\d+/i.test(url)) return 0.9;
    return 0;
  },
  extract: extractStackOverflow,
});

registerTool({
  name: 'pdf',
  description: 'Extracts text from PDF documents via Google Docs viewer or direct binary parsing',
  matchUrl: (url) => /\.pdf(\?|#|$)/i.test(url) ? 0.95 : 0,
  extract: extractPdf,
});

registerTool({
  name: 'news',
  description: 'Enhanced news article extraction with author, date, publisher, metadata enrichment',
  matchUrl: (url) => isNewsUrl(url) ? 0.85 : 0,
  extract: extractNewsArticle,
});

registerTool({
  name: 'structured',
  description: 'Extracts tables, lists, statistics, and structured data from HTML pages',
  matchUrl: (_url) => 0,
  extract: extractStructuredData,
});
