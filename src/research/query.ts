import { ResearchDepth } from '../types';
import { QueryAnalysis, CoverageGap, runSignature } from './signatures';

interface QueryAnalysisResult {
  searchQueries: string[];
  complexity: string;
  domainTags: string[];
  isComparative: boolean;
  subQuestions: string[];
}

interface CoverageGapResult {
  coverageScore: number;
  coveredAspects: string[];
  gaps: string[];
  followUpQueries: string[];
}

export async function analyzeQuery(question: string): Promise<QueryAnalysisResult> {
  return runSignature<QueryAnalysisResult>(QueryAnalysis, { question }, { maxTokens: 800 });
}

export async function generateSearchVariants(query: string, depth: ResearchDepth): Promise<string[]> {
  if (depth === 'quick') return [query];

  try {
    const analysis = await analyzeQuery(query);
    const variants = analysis.searchQueries.slice(0, depth === 'deep' ? 4 : 2);
    if (!variants.includes(query) && variants.length < 4) {
      variants.unshift(query);
    }
    return variants;
  } catch {
    return [query];
  }
}

export async function evaluateCoverage(
  question: string,
  sourceSummaries: { title: string; domain: string; snippet: string }[]
): Promise<CoverageGapResult> {
  return runSignature<CoverageGapResult>(
    CoverageGap,
    {
      question,
      sourceSummaries: JSON.stringify(sourceSummaries),
    },
    { maxTokens: 1000 }
  );
}

export async function generateGapFillingQueries(
  question: string,
  gaps: string[]
): Promise<string[]> {
  if (gaps.length === 0) return [];

  try {
    const coverage = await evaluateCoverage(question, gaps.map((g) => ({
      title: 'gap',
      domain: 'n/a',
      snippet: g,
    })));
    return coverage.followUpQueries.slice(0, 3);
  } catch {
    return gaps.slice(0, 2).map((g) => `${question} ${g}`);
  }
}
