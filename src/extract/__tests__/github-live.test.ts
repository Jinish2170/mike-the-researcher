// Live tests for GitHub extractor — GitHub API is accessible from this environment
import { smartExtract } from '../tools';

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  LIVE GITHUB EXTRACTOR TESTS (via smartExtract)   ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function check(ok: boolean, label: string, detail = '') {
    if (ok) { passed++; console.log(`  ✓ ${label}`); }
    else { failed++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
  }

  // Test 1: Repository page — should use GitHub tool, fetch metadata + README
  console.log('--- Test 1: Repository page ---');
  try {
    const start = Date.now();
    const result = await smartExtract('https://github.com/microsoft/TypeScript', 'TypeScript');
    const dur = Date.now() - start;
    console.log(`  Completed in ${dur}ms`);

    check(result.toolUsed === 'github', `Tool used: ${result.toolUsed}`, 'expected github');
    check(result.title.includes('TypeScript'), `Title: ${result.title.slice(0, 60)}`);
    check(result.textContent.length > 500, `Content length: ${result.textContent.length}`, 'expected > 500');
    check(result.textContent.includes('TypeScript'), 'Content mentions TypeScript');
    check(result.siteName === 'GitHub', `Site name: ${result.siteName}`);

    // Check for metadata in content
    const hasStars = /Stars:\s*\d/.test(result.textContent);
    const hasLanguage = /language/i.test(result.textContent);
    check(hasStars || hasLanguage, 'Contains repo metadata (stars or language)');

    // Check for README
    const hasReadme = result.textContent.includes('README') || result.textContent.length > 2000;
    check(hasReadme, 'Contains README content');
  } catch (err) {
    failed += 7;
    console.log(`  THREW: ${err instanceof Error ? err.message : err}`);
  }

  // Test 2: Another repository
  console.log('\n--- Test 2: Another repo (expressjs/express) ---');
  try {
    const start = Date.now();
    const result = await smartExtract('https://github.com/expressjs/express', 'express web framework');
    const dur = Date.now() - start;
    console.log(`  Completed in ${dur}ms`);

    check(result.toolUsed === 'github', `Tool used: ${result.toolUsed}`);
    check(result.textContent.length > 300, `Content length: ${result.textContent.length}`);
    check(/express/i.test(result.textContent), 'Content mentions express');
  } catch (err) {
    failed += 3;
    console.log(`  THREW: ${err instanceof Error ? err.message : err}`);
  }

  // Test 3: Non-existent repo — should fall back or throw gracefully
  console.log('\n--- Test 3: Non-existent repo (fallback behavior) ---');
  try {
    const result = await smartExtract('https://github.com/zzz-nonexistent-12345/no-repo', 'test');
    check(result.toolUsed.includes('fallback'), `Fell back to: ${result.toolUsed}`);
  } catch (err) {
    // Expected to fail — that's OK, we just want it to not crash with an unhandled error
    check(err instanceof Error, `Threw gracefully: ${(err as Error).message?.slice(0, 80)}`);
  }

  // Test 4: Verify selectRelevantContent is applied (content not longer than maxContentChars)
  console.log('\n--- Test 4: Content length limit ---');
  try {
    const result = await smartExtract('https://github.com/microsoft/TypeScript', 'TypeScript programming');
    // maxContentChars is 8000 by default
    check(result.textContent.length <= 8500, `Content within limit: ${result.textContent.length} chars`);
  } catch (err) {
    failed++;
    console.log(`  THREW: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\n' + '═'.repeat(52));
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  else console.log('ALL LIVE GITHUB TESTS PASSED ✓');
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
