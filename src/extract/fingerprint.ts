const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'about', 'up', 'it',
  'its', 'he', 'she', 'they', 'them', 'this', 'that', 'these', 'those', 'i', 'we',
  'you', 'my', 'your', 'his', 'her', 'our', 'their', 'which', 'who', 'whom', 'what',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function ngrams(tokens: string[], n: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.add(tokens.slice(i, i + n).join(' '));
  }
  return grams;
}

function simhash(text: string): bigint {
  const tokens = tokenize(text);
  const bits = 64;
  const v = new Array(bits).fill(0);

  for (const token of tokens) {
    let hash = BigInt(0);
    for (let i = 0; i < token.length; i++) {
      hash = (hash * BigInt(31) + BigInt(token.charCodeAt(i))) & BigInt('0xFFFFFFFFFFFFFFFF');
    }

    for (let i = 0; i < bits; i++) {
      if ((hash >> BigInt(i)) & BigInt(1)) {
        v[i]++;
      } else {
        v[i]--;
      }
    }
  }

  let fingerprint = BigInt(0);
  for (let i = 0; i < bits; i++) {
    if (v[i] > 0) {
      fingerprint |= BigInt(1) << BigInt(i);
    }
  }
  return fingerprint;
}

function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let dist = 0;
  while (xor > BigInt(0)) {
    dist += Number(xor & BigInt(1));
    xor >>= BigInt(1);
  }
  return dist;
}

export function computeFingerprint(text: string): string {
  return simhash(text).toString(16).padStart(16, '0');
}

function jaccardOnSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const g of a) {
    if (b.has(g)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

export function jaccardSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  // Multi-granularity: combine unigram (word overlap) and bigram (phrase overlap)
  const uni1 = new Set(tokens1);
  const uni2 = new Set(tokens2);
  const bi1 = ngrams(tokens1, 2);
  const bi2 = ngrams(tokens2, 2);
  const tri1 = ngrams(tokens1, 3);
  const tri2 = ngrams(tokens2, 3);

  const uniSim = jaccardOnSets(uni1, uni2);
  const biSim = jaccardOnSets(bi1, bi2);
  const triSim = jaccardOnSets(tri1, tri2);

  // Weighted combination: unigrams catch paraphrases, trigrams catch exact copies
  return uniSim * 0.4 + biSim * 0.35 + triSim * 0.25;
}

export function areSimilar(text1: string, text2: string, threshold = 0.4): boolean {
  // Quick check with simhash first
  const h1 = simhash(text1);
  const h2 = simhash(text2);
  const dist = hammingDistance(h1, h2);
  if (dist > 20) return false;

  // Finer check with Jaccard on 3-grams
  return jaccardSimilarity(text1, text2) >= threshold;
}

export interface DeduplicatedResult<T extends { extractedText?: string; url: string }> {
  items: T[];
  duplicatesRemoved: number;
  clusters: { canonical: string; duplicates: string[] }[];
}

export function deduplicateByContent<T extends { extractedText?: string; url: string }>(
  items: T[],
  threshold = 0.4
): DeduplicatedResult<T> {
  const kept: T[] = [];
  const clusters: { canonical: string; duplicates: string[] }[] = [];
  let duplicatesRemoved = 0;

  for (const item of items) {
    const text = item.extractedText || '';
    if (text.length < 50) {
      kept.push(item);
      continue;
    }

    let isDuplicate = false;
    for (let i = 0; i < kept.length; i++) {
      const keptText = kept[i].extractedText || '';
      if (keptText.length < 50) continue;

      if (areSimilar(text, keptText, threshold)) {
        isDuplicate = true;
        duplicatesRemoved++;
        const existing = clusters.find((c) => c.canonical === kept[i].url);
        if (existing) {
          existing.duplicates.push(item.url);
        } else {
          clusters.push({ canonical: kept[i].url, duplicates: [item.url] });
        }
        break;
      }
    }

    if (!isDuplicate) kept.push(item);
  }

  return { items: kept, duplicatesRemoved, clusters };
}
