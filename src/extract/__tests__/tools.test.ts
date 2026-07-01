import { matchTool, smartExtract, listTools, deduplicateSources } from '../tools';
import { computeFingerprint, jaccardSimilarity, areSimilar, deduplicateByContent } from '../fingerprint';
import { Source } from '../../types';

// ── Tool Registry Tests ────────────────────────────────────────

function testToolMatching() {
  console.log('=== TOOL MATCHING TESTS ===\n');
  const cases: [string, string][] = [
    ['https://en.wikipedia.org/wiki/Artificial_intelligence', 'wikipedia'],
    ['https://github.com/microsoft/TypeScript', 'github'],
    ['https://github.com/facebook/react/issues/123', 'github'],
    ['https://arxiv.org/abs/2301.00001', 'arxiv'],
    ['https://arxiv.org/html/2301.00001', 'arxiv'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.reddit.com/r/programming/comments/abc123/title', 'reddit'],
    ['https://old.reddit.com/r/MachineLearning/comments/xyz/post', 'reddit'],
    ['https://stackoverflow.com/questions/12345/how-to-parse-json', 'stackoverflow'],
    ['https://serverfault.com/questions/99999/something', 'stackoverflow'],
    ['https://example.com/paper.pdf', 'pdf'],
    ['https://arxiv.org/pdf/2301.00001', 'arxiv'],
    ['https://www.nytimes.com/2024/01/01/tech/article.html', 'news'],
    ['https://techcrunch.com/2024/startup-news/', 'news'],
    ['https://www.reuters.com/business/article', 'news'],
    ['https://example.com/random-page', 'readability'],
    ['https://some-blog.com/post/123', 'readability'],
  ];

  let passed = 0;
  let failed = 0;

  for (const [url, expectedTool] of cases) {
    const match = matchTool(url);
    const ok = match.tool === expectedTool;
    if (ok) {
      passed++;
      console.log(`  ✓ ${url} → ${match.tool} (${match.confidence})`);
    } else {
      failed++;
      console.log(`  ✗ ${url} → ${match.tool} (expected ${expectedTool})`);
    }
  }

  console.log(`\n  Results: ${passed}/${passed + failed} passed\n`);
  return failed === 0;
}

// ── Fingerprinting Tests ───────────────────────────────────────

function testFingerprinting() {
  console.log('=== FINGERPRINTING TESTS ===\n');
  let passed = 0;
  let failed = 0;

  // Identical texts should be similar
  const text1 = 'Machine learning is a subset of artificial intelligence that enables systems to learn from data';
  const text2 = 'Machine learning is a subset of artificial intelligence that enables systems to learn from data';
  const sim1 = jaccardSimilarity(text1, text2);
  if (sim1 === 1.0) { passed++; console.log(`  ✓ Identical texts: similarity=${sim1}`); }
  else { failed++; console.log(`  ✗ Identical texts: expected 1.0, got ${sim1}`); }

  // Very similar texts (paraphrased)
  const text3 = 'Machine learning, a branch of artificial intelligence, allows computer systems to learn patterns from data';
  const sim2 = jaccardSimilarity(text1, text3);
  if (sim2 > 0.1 && sim2 < 1.0) { passed++; console.log(`  ✓ Similar texts: similarity=${sim2.toFixed(3)}`); }
  else { failed++; console.log(`  ✗ Similar texts: unexpected similarity=${sim2}`); }

  // Completely different texts
  const text4 = 'The recipe calls for flour, sugar, eggs, and butter mixed together and baked at three hundred degrees';
  const sim3 = jaccardSimilarity(text1, text4);
  if (sim3 < 0.1) { passed++; console.log(`  ✓ Different texts: similarity=${sim3.toFixed(3)}`); }
  else { failed++; console.log(`  ✗ Different texts: expected <0.1, got ${sim3}`); }

  // areSimilar function
  if (areSimilar(text1, text2)) { passed++; console.log('  ✓ areSimilar: identical texts detected'); }
  else { failed++; console.log('  ✗ areSimilar: failed on identical texts'); }

  if (!areSimilar(text1, text4)) { passed++; console.log('  ✓ areSimilar: different texts correctly not similar'); }
  else { failed++; console.log('  ✗ areSimilar: false positive on different texts'); }

  // Fingerprint consistency
  const fp1 = computeFingerprint(text1);
  const fp2 = computeFingerprint(text1);
  if (fp1 === fp2) { passed++; console.log(`  ✓ Fingerprint deterministic: ${fp1}`); }
  else { failed++; console.log(`  ✗ Fingerprint not deterministic: ${fp1} vs ${fp2}`); }

  const fp3 = computeFingerprint(text4);
  if (fp1 !== fp3) { passed++; console.log(`  ✓ Different fingerprints: ${fp1} vs ${fp3}`); }
  else { failed++; console.log('  ✗ Fingerprints should differ for different texts'); }

  console.log(`\n  Results: ${passed}/${passed + failed} passed\n`);
  return failed === 0;
}

// ── Deduplication Tests ────────────────────────────────────────

function testDeduplication() {
  console.log('=== DEDUPLICATION TESTS ===\n');
  let passed = 0;
  let failed = 0;

  const sources: Source[] = [
    {
      id: 1, url: 'https://a.com/page1', title: 'Article A', domain: 'a.com',
      snippet: '', charCount: 500, fetchedAt: '', status: 'ok',
      extractedText: 'Machine learning is a method of data analysis that automates analytical model building. It is a branch of artificial intelligence based on the idea that systems can learn from data, identify patterns and make decisions with minimal human intervention. Machine learning algorithms use historical data as input to predict new output values. Recommendation engines, for example, are a common use case for machine learning.',
    },
    {
      id: 2, url: 'https://b.com/page2', title: 'Article B', domain: 'b.com',
      snippet: '', charCount: 500, fetchedAt: '', status: 'ok',
      extractedText: 'Machine learning is a method of data analysis that automates analytical model building. It is a branch of artificial intelligence based on the idea that systems can learn from data, identify patterns and make decisions with minimal human intervention. Machine learning algorithms use historical data as input to predict new output values. Recommendation engines, for example, are a common use case for machine learning.',
    },
    {
      id: 3, url: 'https://c.com/page3', title: 'Article C', domain: 'c.com',
      snippet: '', charCount: 500, fetchedAt: '', status: 'ok',
      extractedText: 'Quantum computing harnesses quantum mechanical phenomena such as superposition and entanglement to process information fundamentally differently than classical computers. While classical computers use bits that can be zero or one, quantum computers use quantum bits or qubits that can exist in superposition states.',
    },
    {
      id: 4, url: 'https://d.com/page4', title: 'Failed', domain: 'd.com',
      snippet: '', charCount: 0, fetchedAt: '', status: 'failed',
    },
  ];

  const result = deduplicateByContent(sources);

  if (result.duplicatesRemoved === 1) {
    passed++;
    console.log(`  ✓ Removed 1 duplicate (sources 1 and 2 had identical text)`);
  } else {
    failed++;
    console.log(`  ✗ Expected 1 duplicate removed, got ${result.duplicatesRemoved}`);
  }

  if (result.items.length === 3) {
    passed++;
    console.log('  ✓ Kept 3 items (2 unique content + 1 failed)');
  } else {
    failed++;
    console.log(`  ✗ Expected 3 items, got ${result.items.length}`);
  }

  // deduplicateSources wrapper
  const dedupResult = deduplicateSources(sources.filter(s => s.status === 'ok'));
  if (dedupResult.removed === 1) {
    passed++;
    console.log('  ✓ deduplicateSources wrapper works correctly');
  } else {
    failed++;
    console.log(`  ✗ deduplicateSources: expected 1 removed, got ${dedupResult.removed}`);
  }

  console.log(`\n  Results: ${passed}/${passed + failed} passed\n`);
  return failed === 0;
}

// ── List Tools Test ────────────────────────────────────────────

function testListTools() {
  console.log('=== LIST TOOLS TEST ===\n');
  const tools = listTools();
  console.log(`  Registered tools (${tools.length}):`);
  for (const t of tools) {
    console.log(`    • ${t.name}: ${t.description}`);
  }

  const expectedTools = ['readability', 'wikipedia', 'github', 'arxiv', 'youtube', 'reddit', 'stackoverflow', 'pdf', 'news', 'structured'];
  let passed = 0;
  let failed = 0;

  for (const name of expectedTools) {
    if (tools.find(t => t.name === name)) {
      passed++;
    } else {
      failed++;
      console.log(`  ✗ Missing tool: ${name}`);
    }
  }

  console.log(`\n  Results: ${passed}/${passed + failed} tools registered\n`);
  return failed === 0;
}

// ── Run all unit tests ─────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  UNIT TESTS: Tool Registry & Utilities   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const results: boolean[] = [];
  results.push(testToolMatching());
  results.push(testFingerprinting());
  results.push(testDeduplication());
  results.push(testListTools());

  const allPassed = results.every(r => r);
  console.log('═'.repeat(44));
  if (allPassed) {
    console.log('ALL UNIT TESTS PASSED ✓');
  } else {
    console.log('SOME UNIT TESTS FAILED ✗');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
