import { CONFIG } from '../config';
import { searchWeb } from '../search';
import { searchSemanticScholar } from '../search/academic';
import { domainOf, selectRelevantContent } from '../extract/readability';
import { smartExtract, deduplicateSources, enrichWithMetadata } from '../extract/tools';
import { fetchWithRetry } from '../extract/retry';
import { getModelName } from '../llm/client';
import { ResearchDepth, ResearchRecord, ResearchBrief, Source, SearchResult, ProgressHandler } from '../types';
import { ResearchError } from '../utils/errors';
import { singlePassSynthesize, multiPassSynthesize } from './synthesis';
import { generateSearchVariants, evaluateCoverage } from './query';
import { scoreAndRankResults, filterLowQualityUrls, enforceSourceDiversity, categorizeUrl, ScoredResult } from './scoring';
import { getResearchCache } from './cache';

export interface ResearchOptions {
  query: string;
  depth: ResearchDepth;
  onProgress?: ProgressHandler;
}

const DEPTH_CONFIG: Record<ResearchDepth, {
  maxSources: number;
  searchLimit: number;
  maxGEPAIterations: number;
  coverageThreshold: number;
  useMultiQuery: boolean;
  useMultiPassSynthesis: boolean;
  useAcademicSearch: boolean;
  maxPerCategory: number;
}> = {
  quick: {
    maxSources: 3,
    searchLimit: 6,
    maxGEPAIterations: 1,
    coverageThreshold: 0.5,
    useMultiQuery: false,
    useMultiPassSynthesis: false,
    useAcademicSearch: false,
    maxPerCategory: 3,
  },
  standard: {
    maxSources: 6,
    searchLimit: 12,
    maxGEPAIterations: 2,
    coverageThreshold: 0.7,
    useMultiQuery: true,
    useMultiPassSynthesis: false,
    useAcademicSearch: false,
    maxPerCategory: 3,
  },
  deep: {
    maxSources: 10,
    searchLimit: 20,
    maxGEPAIterations: 3,
    coverageThreshold: 0.85,
    useMultiQuery: true,
    useMultiPassSynthesis: true,
    useAcademicSearch: true,
    maxPerCategory: 4,
  },
};

function generateId(): string {
  return `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deduplicateByDomain(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const d = domainOf(r.url);
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });
}

async function createConcurrencyLimiter(concurrency: number) {
  // p-queue v8 is ESM-only; use dynamic import since this function is async
  try {
    const { default: PQueue } = await import('p-queue');
    return new PQueue({ concurrency });
  } catch {
    // Fallback: simple Promise-based concurrency limiter
    return {
      add: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      onIdle: async () => {},
    };
  }
}

async function fetchAndBuildSources(
  results: SearchResult[],
  query: string,
  startId: number,
  onProgress?: ProgressHandler
): Promise<Source[]> {
  const queue = await createConcurrencyLimiter(CONFIG.search.fetchConcurrency);
  const sources: Source[] = [];

  const tasks = results.map((r, idx) => {
    const sourceId = startId + idx;
    return queue.add(async () => {
      const domain = domainOf(r.url);
      onProgress?.({ phase: 'fetch', message: `Reading ${r.url}` });

      try {
        const extracted = await fetchWithRetry(
          () => smartExtract(r.url, query),
          {
            maxRetries: 1,
            baseDelayMs: 1000,
            onRetry: (n, err) =>
              onProgress?.({ phase: 'fetch', message: `Retry ${n} for ${domain}: ${err.message}` }),
          }
        );

        const relevantText = selectRelevantContent(extracted.textContent, query, CONFIG.search.maxContentChars);
        const charCount = relevantText.length;
        const toolLabel = extracted.toolUsed !== 'readability' ? ` [${extracted.toolUsed}]` : '';

        onProgress?.({
          phase: 'extract',
          message: `Extracted ${charCount.toLocaleString()} chars from ${domain}${toolLabel}`,
        });

        sources.push({
          id: sourceId,
          url: extracted.url,
          title: extracted.title,
          domain,
          snippet: r.snippet,
          extractedText: relevantText,
          charCount,
          fetchedAt: new Date().toISOString(),
          status: 'ok',
          qualityScore: (r as ScoredResult).qualityScore,
          category: categorizeUrl(r.url),
        });
      } catch (err) {
        sources.push({
          id: sourceId,
          url: r.url,
          title: r.title,
          domain,
          snippet: r.snippet,
          charCount: 0,
          fetchedAt: new Date().toISOString(),
          status: 'failed',
          failureReason: err instanceof Error ? err.message : String(err),
          category: categorizeUrl(r.url),
        });
      }
    });
  });

  await Promise.all(tasks);
  return sources.sort((a, b) => a.id - b.id);
}

// ── GEPA Research Loop ────────────────────────────────────────
// Generate queries → Evaluate coverage → Plan follow-ups → Act on gaps

export async function research(opts: ResearchOptions): Promise<ResearchRecord> {
  const start = Date.now();
  const config = DEPTH_CONFIG[opts.depth];
  const { onProgress } = opts;

  // Check cache first
  const cached = getResearchCache().get(opts.query, opts.depth);
  if (cached) {
    onProgress?.({ phase: 'done', message: 'Returning cached result' });
    return cached;
  }

  try {
    // ── GENERATE: Create search queries ────────────────────────
    onProgress?.({ phase: 'search', message: 'Analyzing query and generating search strategy...' });

    let searchQueries: string[];
    if (config.useMultiQuery) {
      try {
        searchQueries = await generateSearchVariants(opts.query, opts.depth);
        onProgress?.({
          phase: 'search',
          message: `Generated ${searchQueries.length} search variants for broader coverage`,
        });
      } catch {
        searchQueries = [opts.query];
      }
    } else {
      searchQueries = [opts.query];
    }

    // ── ACT: Execute searches ──────────────────────────────────
    let allSearchResults: SearchResult[] = [];

    for (const q of searchQueries) {
      onProgress?.({ phase: 'search', message: `Searching the web for: ${q}` });
      const results = await searchWeb(q, config.searchLimit);
      allSearchResults.push(...results);
    }

    // Add academic results for deep mode
    if (config.useAcademicSearch) {
      onProgress?.({ phase: 'search', message: 'Searching academic databases...' });
      try {
        const academicResults = await searchSemanticScholar(opts.query, 5);
        if (academicResults.length > 0) {
          onProgress?.({ phase: 'search', message: `Found ${academicResults.length} academic papers` });
          allSearchResults.push(...academicResults);
        }
      } catch {
        // Academic search is optional, continue without it
      }
    }

    if (allSearchResults.length === 0) {
      throw new ResearchError('No search results found for this query. Try rephrasing.', 'search');
    }

    // ── Score, filter, and deduplicate ─────────────────────────
    let filtered = filterLowQualityUrls(allSearchResults);
    let scored = scoreAndRankResults(filtered, opts.query);
    scored = enforceSourceDiversity(scored, config.maxPerCategory);
    let topResults = deduplicateByDomain(scored).slice(0, config.maxSources);

    onProgress?.({
      phase: 'search',
      message: `Selected ${topResults.length} high-quality sources from ${allSearchResults.length} results`,
    });

    // ── Fetch and extract sources ──────────────────────────────
    let allSources = await fetchAndBuildSources(topResults, opts.query, 1, onProgress);

    // ── EVALUATE: Coverage gap analysis (GEPA loop) ────────────
    const okSources = () => allSources.filter((s) => s.status === 'ok');
    let iteration = 1;

    while (iteration < config.maxGEPAIterations && okSources().length >= 2) {
      onProgress?.({
        phase: 'search',
        message: `Evaluating coverage (iteration ${iteration + 1}/${config.maxGEPAIterations})...`,
      });

      try {
        const sourceSummaries = okSources().map((s) => ({
          title: s.title,
          domain: s.domain,
          snippet: s.snippet || (s.extractedText || '').slice(0, 200),
        }));

        const coverage = await evaluateCoverage(opts.query, sourceSummaries);

        if (coverage.coverageScore >= config.coverageThreshold) {
          onProgress?.({
            phase: 'search',
            message: `Coverage ${Math.round(coverage.coverageScore * 100)}% meets threshold — proceeding to synthesis`,
          });
          break;
        }

        // ── PLAN & ACT: Fill gaps ──────────────────────────────
        if (coverage.followUpQueries.length > 0) {
          onProgress?.({
            phase: 'search',
            message: `Coverage ${Math.round(coverage.coverageScore * 100)}% — searching for: ${coverage.gaps.slice(0, 2).join(', ')}`,
          });

          const gapQueries = coverage.followUpQueries.slice(0, 2);
          const gapResults: SearchResult[] = [];

          for (const gq of gapQueries) {
            const results = await searchWeb(gq, 4);
            gapResults.push(...results);
          }

          const newFiltered = filterLowQualityUrls(gapResults);
          const existingDomains = new Set(allSources.map((s) => s.domain));
          const newUnique = newFiltered.filter((r) => !existingDomains.has(domainOf(r.url)));

          if (newUnique.length > 0) {
            const newScoredResults = scoreAndRankResults(newUnique, opts.query).slice(0, 3);
            const nextId = allSources.length + 1;
            const newSources = await fetchAndBuildSources(newScoredResults, opts.query, nextId, onProgress);
            allSources = [...allSources, ...newSources];
          }
        }
      } catch {
        // Coverage evaluation failed, proceed with what we have
        break;
      }

      iteration++;
    }

    // ── DEDUPLICATE: Remove near-duplicate content ──────────
    const dedup = deduplicateSources(allSources.filter((s) => s.status === 'ok'));
    if (dedup.removed > 0) {
      onProgress?.({
        phase: 'extract',
        message: `Removed ${dedup.removed} near-duplicate source(s)`,
      });
      const failedSources = allSources.filter((s) => s.status !== 'ok');
      allSources = [...dedup.sources, ...failedSources];
    }

    // ── SYNTHESIZE ─────────────────────────────────────────────
    const finalOkSources = okSources();

    if (finalOkSources.length === 0) {
      throw new ResearchError(
        'All source fetches failed. Check network connectivity or try a different query.',
        'fetch'
      );
    }

    onProgress?.({
      phase: 'synthesize',
      message: `Synthesizing brief from ${finalOkSources.length} sources with ${getModelName()}`,
    });

    let brief: ResearchBrief;
    if (config.useMultiPassSynthesis && finalOkSources.length >= 3) {
      brief = await multiPassSynthesize(opts.query, allSources, onProgress);
    } else {
      brief = await singlePassSynthesize(opts.query, allSources, onProgress);
    }

    // ── Build record ───────────────────────────────────────────
    const durationMs = Date.now() - start;
    const record: ResearchRecord = {
      id: generateId(),
      query: opts.query,
      depth: opts.depth,
      brief,
      sources: allSources,
      stats: {
        searchResults: allSearchResults.length,
        sourcesFetched: finalOkSources.length,
        sourcesFailed: allSources.length - finalOkSources.length,
        totalCharsRead: finalOkSources.reduce((n, s) => n + s.charCount, 0),
        durationMs,
        model: getModelName(),
      },
      createdAt: new Date().toISOString(),
    };

    onProgress?.({ phase: 'done', message: `Research complete in ${(durationMs / 1000).toFixed(1)}s` });

    // Cache the result
    getResearchCache().set(opts.query, opts.depth, record);

    return record;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ phase: 'error', message });
    throw err instanceof ResearchError
      ? err
      : new ResearchError(message, 'error', err instanceof Error ? err : undefined);
  }
}
