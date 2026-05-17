// OpenAI-compatible LLM client. Works with OpenAI, OpenRouter, Groq, Together, Ollama, etc.
import OpenAI from 'openai';
import { CONFIG, assertLlmConfigured } from '../config';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  assertLlmConfigured();
  if (!_client) {
    _client = new OpenAI({
      apiKey: CONFIG.llm.apiKey,
      baseURL: CONFIG.llm.baseURL,
    });
  }
  return _client;
}

export interface ChatOptions {
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const client = getClient();
  const messages: { role: 'system' | 'user'; content: string }[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user });

  const response = await client.chat.completions.create({
    model: CONFIG.llm.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1500,
    ...(opts.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  });

  return response.choices[0]?.message?.content?.trim() || '';
}

export function getModelName(): string {
  return CONFIG.llm.model;
}
