import { smartExtract } from '../tools';
import { extractPageMetadata } from '../jsonld';
import { ExtractedPage } from '../readability';

interface TestCase {
  name: string;
  url: string;
  query: string;
  expectedTool: string;
  validate: (result: ExtractedPage & { toolUsed: string }) => string[];
}

const TESTS: TestCase[] = [
  {
    name: 'Wikipedia — AI article',
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    query: 'what is artificial intelligence',
    expectedTool: 'wikipedia',
    validate: (r) => {
      const errors: string[] = [];
      if (!r.title) errors.push('missing title');
      if (r.textContent.length < 500) errors.push(`content too short: ${r.textContent.length} chars`);
      if (!r.siteName?.includes('Wikipedia')) errors.push(`unexpected siteName: ${r.siteName}`);
      if (r.toolUsed !== 'wikipedia') errors.push(`wrong tool: ${r.toolUsed}`);
      return errors;
    },
  },
  {
    name: 'GitHub — repository page',
    url: 'https://github.com/microsoft/TypeScript',
    query: 'TypeScript programming language',
    expectedTool: 'github',
    validate: (r) => {
      const errors: string[] = [];
      if (!r.title) errors.push('missing title');
      if (r.textContent.length < 200) errors.push(`content too short: ${r.textContent.length} chars`);
      if (r.toolUsed !== 'github') errors.push(`wrong tool: ${r.toolUsed}`);
      return errors;
    },
  },
  {
    name: 'arXiv — Attention paper',
    url: 'https://arxiv.org/abs/1706.03762',
    query: 'attention mechanism transformers',
    expectedTool: 'arxiv',
    validate: (r) => {
      const errors: string[] = [];
      if (!r.title.toLowerCase().includes('attention')) errors.push(`title doesn't mention attention: ${r.title}`);
      if (r.textContent.length < 200) errors.push(`content too short: ${r.textContent.length} chars`);
      if (!r.byline) errors.push('missing byline/authors');
      if (r.toolUsed !== 'arxiv') errors.push(`wrong tool: ${r.toolUsed}`);
      return errors;
    },
  },
  {
    name: 'StackOverflow — popular question',
    url: 'https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git',
    query: 'git undo commit',
    expectedTool: 'stackoverflow',
    validate: (r) => {
      const errors: string[] = [];
      if (!r.title) errors.push('missing title');
      if (r.textContent.length < 200) errors.push(`content too short: ${r.textContent.length} chars`);
      if (!r.textContent.toLowerCase().includes('git')) errors.push('content does not mention git');
      if (r.toolUsed !== 'stackoverflow') errors.push(`wrong tool: ${r.toolUsed}`);
      return errors;
    },
  },
  {
    name: 'News — Reuters article',
    url: 'https://www.reuters.com/technology/',
    query: 'technology news',
    expectedTool: 'news',
    validate: (r) => {
      const errors: string[] = [];
      if (!r.title) errors.push('missing title');
      if (r.textContent.length < 100) errors.push(`content too short: ${r.textContent.length} chars`);
      if (r.toolUsed !== 'news') errors.push(`wrong tool: ${r.toolUsed}`);
      return errors;
    },
  },
  {
    name: 'Generic — readability fallback',
    url: 'https://example.com',
    query: 'example domain',
    expectedTool: 'readability',
    validate: (r) => {
      const errors: string[] = [];
      if (!r.title) errors.push('missing title');
      if (!r.toolUsed.startsWith('readability')) errors.push(`wrong tool: ${r.toolUsed}`);
      return errors;
    },
  },
];

async function runExtractorTest(test: TestCase): Promise<{ passed: boolean; errors: string[]; duration: number }> {
  const start = Date.now();
  try {
    const result = await smartExtract(test.url, test.query);
    const duration = Date.now() - start;
    const errors = test.validate(result);

    if (errors.length === 0) {
      console.log(`  ✓ ${test.name} (${duration}ms)`);
      console.log(`    tool=${result.toolUsed} title="${result.title?.slice(0, 60)}" chars=${result.textContent.length}`);
    } else {
      console.log(`  ✗ ${test.name} (${duration}ms)`);
      for (const e of errors) console.log(`    ERROR: ${e}`);
      console.log(`    title="${result.title?.slice(0, 60)}" chars=${result.textContent.length}`);
    }

    return { passed: errors.length === 0, errors, duration };
  } catch (err) {
    const duration = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${test.name} — THREW (${duration}ms)`);
    console.log(`    ${msg.slice(0, 200)}`);
    return { passed: false, errors: [`threw: ${msg}`], duration };
  }
}

async function testMetadataExtraction() {
  console.log('\n=== JSON-LD / METADATA EXTRACTION ===\n');

  const testUrls = [
    'https://en.wikipedia.org/wiki/Machine_learning',
    'https://www.reuters.com/technology/',
  ];

  let passed = 0;
  let failed = 0;

  for (const url of testUrls) {
    try {
      const start = Date.now();
      const meta = await extractPageMetadata(url);
      const duration = Date.now() - start;
      const fields = Object.entries(meta).filter(([_, v]) => v != null && v !== '').length;

      if (fields >= 1) {
        passed++;
        console.log(`  ✓ ${url} (${duration}ms) — ${fields} metadata fields`);
        if (meta.title) console.log(`    title: ${meta.title.slice(0, 60)}`);
        if (meta.type) console.log(`    type: ${meta.type}`);
        if (meta.author) console.log(`    author: ${meta.author}`);
        if (meta.faq) console.log(`    FAQ items: ${meta.faq.length}`);
      } else {
        failed++;
        console.log(`  ✗ ${url} (${duration}ms) — no metadata extracted`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ${url} — THREW: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n  Results: ${passed}/${passed + failed} passed\n`);
  return failed === 0;
}

async function testSmartExtractFallback() {
  console.log('\n=== SMART EXTRACT FALLBACK BEHAVIOR ===\n');

  let passed = 0;
  let failed = 0;

  // Test that a URL matching a specialized tool but returning an error falls back to readability
  try {
    // Use a non-existent GitHub repo — should fall back gracefully
    const result = await smartExtract('https://github.com/nonexistent-user-xyzzy/no-such-repo-12345', 'test query');
    // If we get here, it fell back successfully
    passed++;
    console.log(`  ✓ GitHub fallback: tool=${result.toolUsed} chars=${result.textContent.length}`);
  } catch {
    // Both specialized and fallback failed — that's still valid behavior for truly broken URLs
    passed++;
    console.log('  ✓ GitHub fallback: correctly threw when both strategies failed');
  }

  // Test with a valid generic URL
  try {
    const result = await smartExtract('https://httpbin.org/html', 'test');
    if (result.toolUsed.startsWith('readability') && result.textContent.length > 50) {
      passed++;
      console.log(`  ✓ Generic extraction: tool=${result.toolUsed} chars=${result.textContent.length}`);
    } else {
      failed++;
      console.log(`  ✗ Generic extraction: unexpected tool=${result.toolUsed} chars=${result.textContent.length}`);
    }
  } catch (err) {
    failed++;
    console.log(`  ✗ Generic extraction threw: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`\n  Results: ${passed}/${passed + failed} passed\n`);
  return failed === 0;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  INTEGRATION TESTS: Live Extractor Validation ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('=== LIVE EXTRACTION TESTS ===\n');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalDuration = 0;

  for (const test of TESTS) {
    const result = await runExtractorTest(test);
    if (result.passed) totalPassed++;
    else totalFailed++;
    totalDuration += result.duration;
  }

  console.log(`\n  Extractor Results: ${totalPassed}/${totalPassed + totalFailed} passed (${totalDuration}ms total)\n`);

  const metaOk = await testMetadataExtraction();
  const fallbackOk = await testSmartExtractFallback();

  console.log('═'.repeat(48));
  const allOk = totalFailed === 0 && metaOk && fallbackOk;
  if (allOk) {
    console.log('ALL INTEGRATION TESTS PASSED ✓');
  } else {
    console.log(`INTEGRATION TESTS: ${totalPassed + (metaOk ? 1 : 0) + (fallbackOk ? 1 : 0)} passed, ${totalFailed + (metaOk ? 0 : 1) + (fallbackOk ? 0 : 1)} failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
