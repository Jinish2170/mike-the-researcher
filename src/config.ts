import 'dotenv/config';

export const CONFIG = {
  llm: {
    baseURL: process.env.LLM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'meta/llama-3.3-70b-instruct',
  },
  search: {
    tavilyApiKey: process.env.TAVILY_API_KEY || '',
    userAgent:
      process.env.USER_AGENT ||
      'Mozilla/5.0 (compatible; MikeTheResearcher/0.1; +https://github.com/Jinish2170/mike-the-researcher)',
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10),
    fetchConcurrency: parseInt(process.env.FETCH_CONCURRENCY || '4', 10),
    maxContentChars: parseInt(process.env.MAX_CONTENT_CHARS || '8000', 10),
  },
  server: {
    port: parseInt(process.env.PORT || '3002', 10),
  },
};

export function assertLlmConfigured(): void {
  if (!CONFIG.llm.apiKey) {
    throw new Error(
      'LLM_API_KEY is not set. Copy .env.example to .env and add an NVIDIA NIM API key from https://build.nvidia.com/ (or any OpenAI-compatible provider).'
    );
  }
}
