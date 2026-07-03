import { chat } from '../llm/client';
import { fetchWithRetry } from '../extract/retry';

export interface SignatureField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'object[]';
  description: string;
}

export interface Signature {
  name: string;
  description: string;
  inputs: SignatureField[];
  outputs: SignatureField[];
}

function buildSchemaType(type: SignatureField['type']): object {
  switch (type) {
    case 'string': return { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'string[]': return { type: 'array', items: { type: 'string' } };
    case 'object[]': return { type: 'array', items: { type: 'object' } };
  }
}

function buildJsonSchema(sig: Signature): string {
  const properties: Record<string, object> = {};
  for (const f of sig.outputs) {
    properties[f.name] = { ...buildSchemaType(f.type), description: f.description };
  }
  return JSON.stringify({
    type: 'object',
    properties,
    required: sig.outputs.map((f) => f.name),
  });
}

function buildSignaturePrompt(sig: Signature, inputs: Record<string, unknown>): { system: string; user: string } {
  const inputSection = sig.inputs
    .map((f) => `**${f.name}** (${f.description}): ${typeof inputs[f.name] === 'string' ? inputs[f.name] : JSON.stringify(inputs[f.name])}`)
    .join('\n\n');

  const system = [
    `You are an expert AI performing the task: ${sig.description}`,
    '',
    'You MUST return valid JSON matching this schema:',
    buildJsonSchema(sig),
    '',
    'Return ONLY the JSON object. No explanation, no markdown fences.',
  ].join('\n');

  const user = inputSection;

  return { system, user };
}

function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  return raw.trim();
}

export async function runSignature<T>(
  sig: Signature,
  inputs: Record<string, unknown>,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<T> {
  const { system, user } = buildSignaturePrompt(sig, inputs);

  const raw = await fetchWithRetry(
    () => chat({
      system,
      user,
      temperature: opts?.temperature ?? 0.15,
      maxTokens: opts?.maxTokens ?? 2000,
      jsonMode: true,
    }),
    {
      maxRetries: 2,
      baseDelayMs: 2000,
      shouldRetry: (err) => {
        const msg = err.message.toLowerCase();
        return msg.includes('rate') || msg.includes('timeout') || msg.includes('5') || msg.includes('server');
      },
    }
  );

  const parsed = JSON.parse(extractJSON(raw));
  return parsed as T;
}

// ── Predefined Signatures ──────────────────────────────────────

export const QueryAnalysis: Signature = {
  name: 'QueryAnalysis',
  description: 'Analyze a research question to determine its complexity, generate optimized search queries, and identify domain tags.',
  inputs: [
    { name: 'question', type: 'string', description: 'The original research question' },
  ],
  outputs: [
    { name: 'searchQueries', type: 'string[]', description: 'Two to four optimized web search queries that approach the question from different angles' },
    { name: 'complexity', type: 'string', description: 'One of: simple, moderate, complex, comparative' },
    { name: 'domainTags', type: 'string[]', description: 'Relevant knowledge domains, e.g. ["machine learning", "natural language processing"]' },
    { name: 'isComparative', type: 'boolean', description: 'True if the question compares two or more things' },
    { name: 'subQuestions', type: 'string[]', description: 'If complex or comparative, 2-3 independent sub-questions to research separately. Empty array if simple.' },
  ],
};

export const CoverageGap: Signature = {
  name: 'CoverageGap',
  description: 'Evaluate how well the collected sources answer the research question. Identify specific gaps and suggest follow-up queries.',
  inputs: [
    { name: 'question', type: 'string', description: 'The original research question' },
    { name: 'sourceSummaries', type: 'string', description: 'JSON array of {title, domain, snippet} for each source found so far' },
  ],
  outputs: [
    { name: 'coverageScore', type: 'number', description: 'How well the sources cover the question, 0.0 to 1.0' },
    { name: 'coveredAspects', type: 'string[]', description: 'Aspects of the question that ARE well covered' },
    { name: 'gaps', type: 'string[]', description: 'Specific aspects of the question NOT covered by current sources' },
    { name: 'followUpQueries', type: 'string[]', description: 'Targeted search queries to fill the identified gaps' },
  ],
};

export const FactExtraction: Signature = {
  name: 'FactExtraction',
  description: 'Extract key facts, claims, and entities from a source text relevant to the research question.',
  inputs: [
    { name: 'question', type: 'string', description: 'The research question' },
    { name: 'sourceId', type: 'number', description: 'The source citation number' },
    { name: 'sourceTitle', type: 'string', description: 'Title of the source' },
    { name: 'sourceText', type: 'string', description: 'Extracted text content from the source' },
  ],
  outputs: [
    { name: 'facts', type: 'string[]', description: 'Five to ten key factual claims from this source relevant to the question' },
    { name: 'entities', type: 'string[]', description: 'Important named entities (people, organizations, concepts, technologies)' },
    { name: 'relevanceScore', type: 'number', description: 'How relevant this source is to the question, 0.0 to 1.0' },
  ],
};

export const CrossSynthesis: Signature = {
  name: 'CrossSynthesis',
  description: 'Synthesize a research brief from extracted facts across multiple sources. Every factual claim MUST have an inline citation [n] referencing the source it came from. Surface disagreements between sources. Assess confidence based on source agreement and diversity.',
  inputs: [
    { name: 'question', type: 'string', description: 'The original research question' },
    { name: 'factSets', type: 'string', description: 'JSON array of {sourceId, sourceTitle, sourceDomain, facts[], entities[], relevanceScore} per source' },
    { name: 'sourceCount', type: 'number', description: 'Total number of sources' },
  ],
  outputs: [
    { name: 'summary', type: 'string', description: 'Two to four paragraph synthesis with inline [n] citations after every factual claim. Surface disagreements explicitly.' },
    { name: 'keyPoints', type: 'string[]', description: 'Three to seven bullet-point highlights, each with [n] citations' },
    { name: 'followUpQuestions', type: 'string[]', description: 'Two to four genuinely useful follow-up research questions' },
    { name: 'confidence', type: 'string', description: 'One of: low, medium, high — based on source count, agreement, and authority' },
    { name: 'reasoning', type: 'string', description: 'One to two sentences explaining the confidence assessment' },
  ],
};
