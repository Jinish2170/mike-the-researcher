import { ResearchRecord, ResearchDepth } from '../types';

interface CacheEntry {
  record: ResearchRecord;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_ENTRIES = 100;

function normalize(query: string): string {
  return query.toLowerCase().trim().replace(/[?!.]+$/, '');
}

function cacheKey(query: string, depth: ResearchDepth): string {
  return `${normalize(query)}::${depth}`;
}

class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(query: string, depth: ResearchDepth): ResearchRecord | null {
    const key = cacheKey(query, depth);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.record;
  }

  set(query: string, depth: ResearchDepth, record: ResearchRecord): void {
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(cacheKey(query, depth), {
      record,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.store.clear();
  }
}

let _cache: MemoryCache | null = null;

export function getResearchCache(ttlMs = DEFAULT_TTL_MS): MemoryCache {
  if (!_cache) _cache = new MemoryCache(ttlMs);
  return _cache;
}
