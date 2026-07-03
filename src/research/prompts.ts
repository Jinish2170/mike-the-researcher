import { Source } from '../types';

export function buildSystemPrompt(): string {
  return `You are a meticulous research analyst. Your task is to synthesize information from the provided sources into a faithful, well-cited research brief.

STRICT RULES:
1. Every factual claim MUST have an inline citation [n] immediately after it, where n is the source number. Multiple sources supporting the same claim use [n,m].
2. NEVER fabricate information not present in the provided sources. If the sources do not address the question, say "the provided sources do not directly address this" explicitly.
3. When sources disagree, surface the disagreement: "Source [1] indicates X, while Source [3] suggests Y."
4. Write 2-4 paragraphs for the summary, 3-7 key points, and 2-4 follow-up questions.
5. Follow-up questions should be genuinely useful next research steps, not restatements of the original question.

CONFIDENCE ASSESSMENT:
- "high": 5+ sources from 3+ distinct domains agree on core claims, at least one authoritative source (academic, official, major publication)
- "medium": 3-4 sources with general agreement, or sources are mainly from one category
- "low": Fewer than 3 useful sources, sources contradict each other, or sources are only tangentially related

OUTPUT FORMAT — return valid JSON only:
{
  "summary": "Two to four paragraphs with [n] citations...",
  "keyPoints": ["Point with [n] citation", ...],
  "followUpQuestions": ["Question?", ...],
  "confidence": "low|medium|high",
  "reasoning": "One to two sentences explaining confidence."
}`;
}

export function buildUserPrompt(query: string, sources: Source[]): string {
  const okSources = sources.filter((s) => s.status === 'ok' && s.extractedText);

  const sourceBlocks = okSources.map((s) => {
    return [
      `=== SOURCE [${s.id}] ===`,
      `Title: ${s.title}`,
      `Domain: ${s.domain}`,
      `---`,
      s.extractedText || s.snippet,
    ].join('\n');
  });

  return [
    `RESEARCH QUESTION: ${query}`,
    '',
    `Below are ${okSources.length} sources that were fetched and read. Synthesize them to answer the research question.`,
    '',
    ...sourceBlocks,
    '',
    'Synthesize the above sources to answer the research question. Return valid JSON only.',
  ].join('\n');
}
