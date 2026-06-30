import { Source, ResearchBrief, ProgressHandler } from '../types';
import { chat } from '../llm/client';
import { fetchWithRetry } from '../extract/retry';
import { buildSystemPrompt, buildUserPrompt } from './prompts';
import { FactExtraction, CrossSynthesis, runSignature } from './signatures';

interface FactSet {
  sourceId: number;
  sourceTitle: string;
  sourceDomain: string;
  facts: string[];
  entities: string[];
  relevanceScore: number;
}

function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return raw.trim();
}

function validateBrief(obj: unknown): ResearchBrief {
  const o = obj as Record<string, unknown>;
  return {
    summary: typeof o.summary === 'string' ? o.summary : '',
    keyPoints: Array.isArray(o.keyPoints) ? o.keyPoints.map(String) : [],
    followUpQuestions: Array.isArray(o.followUpQuestions) ? o.followUpQuestions.map(String) : [],
    confidence: (['low', 'medium', 'high'].includes(o.confidence as string)
      ? o.confidence
      : 'low') as ResearchBrief['confidence'],
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : undefined,
  };
}

export async function singlePassSynthesize(
  query: string,
  sources: Source[],
  onProgress?: ProgressHandler
): Promise<ResearchBrief> {
  onProgress?.({ phase: 'synthesize', message: 'Synthesizing brief from sources...' });

  const raw = await fetchWithRetry(
    () => chat({
      system: buildSystemPrompt(),
      user: buildUserPrompt(query, sources),
      temperature: 0.2,
      maxTokens: 4000,
      jsonMode: true,
    }),
    { maxRetries: 2, baseDelayMs: 2000 }
  );

  try {
    return validateBrief(JSON.parse(extractJSON(raw)));
  } catch {
    return {
      summary: raw,
      keyPoints: [],
      followUpQuestions: [],
      confidence: 'low',
      reasoning: 'LLM output could not be parsed as structured JSON.',
    };
  }
}

async function extractFactsFromSource(
  query: string,
  source: Source
): Promise<FactSet> {
  try {
    const result = await runSignature<{ facts: string[]; entities: string[]; relevanceScore: number }>(
      FactExtraction,
      {
        question: query,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceText: (source.extractedText || source.snippet).slice(0, 6000),
      },
      { maxTokens: 1200 }
    );

    return {
      sourceId: source.id,
      sourceTitle: source.title,
      sourceDomain: source.domain,
      facts: result.facts || [],
      entities: result.entities || [],
      relevanceScore: typeof result.relevanceScore === 'number' ? result.relevanceScore : 0.5,
    };
  } catch {
    return {
      sourceId: source.id,
      sourceTitle: source.title,
      sourceDomain: source.domain,
      facts: [],
      entities: [],
      relevanceScore: 0,
    };
  }
}

export async function multiPassSynthesize(
  query: string,
  sources: Source[],
  onProgress?: ProgressHandler
): Promise<ResearchBrief> {
  const okSources = sources.filter((s) => s.status === 'ok' && s.extractedText);

  if (okSources.length === 0) {
    return {
      summary: 'No sources could be successfully fetched to answer this question.',
      keyPoints: [],
      followUpQuestions: [],
      confidence: 'low',
      reasoning: 'All source fetches failed.',
    };
  }

  // Pass 1: Extract facts from each source concurrently
  onProgress?.({ phase: 'synthesize', message: `Pass 1: Extracting facts from ${okSources.length} sources...` });

  const factPromises = okSources.map((s) => extractFactsFromSource(query, s));
  const factSets = await Promise.all(factPromises);

  const usefulFacts = factSets.filter((f) => f.facts.length > 0);
  onProgress?.({
    phase: 'synthesize',
    message: `Pass 1 complete: ${usefulFacts.reduce((n, f) => n + f.facts.length, 0)} facts extracted from ${usefulFacts.length} sources`,
  });

  if (usefulFacts.length === 0) {
    return singlePassSynthesize(query, sources, onProgress);
  }

  // Pass 2: Cross-source synthesis from structured facts
  onProgress?.({ phase: 'synthesize', message: 'Pass 2: Cross-source synthesis and verification...' });

  try {
    const result = await runSignature<{
      summary: string;
      keyPoints: string[];
      followUpQuestions: string[];
      confidence: string;
      reasoning: string;
    }>(
      CrossSynthesis,
      {
        question: query,
        factSets: JSON.stringify(usefulFacts),
        sourceCount: okSources.length,
      },
      { maxTokens: 4000, temperature: 0.2 }
    );

    return validateBrief(result);
  } catch {
    onProgress?.({ phase: 'synthesize', message: 'Cross-synthesis failed, falling back to single-pass...' });
    return singlePassSynthesize(query, sources, onProgress);
  }
}
