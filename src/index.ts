// Mike the Researcher — CLI entry + programmatic exports
import { research } from './research/engine';
import { getResearchStore } from './research/store';
import { ResearchDepth } from './types';

export { research } from './research/engine';
export { getResearchStore, ResearchStore } from './research/store';
export { chat } from './llm/client';
export { searchWeb } from './search';
export { extractPage } from './extract/readability';
export type { ResearchRecord, ResearchBrief, Source, ResearchDepth, ResearchSummary } from './types';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
Mike the Researcher — AI research assistant

Usage:
  npm run dev -- "<your research question>" [quick|standard|deep]
  npm run api      Start the API server + dashboard backend

Examples:
  npm run dev -- "what is retrieval-augmented generation?"
  npm run dev -- "latest progress on fusion energy" deep
`);
    return;
  }

  const depth = (['quick', 'standard', 'deep'].includes(args[args.length - 1])
    ? args.pop()
    : 'standard') as ResearchDepth;
  const query = args.join(' ');

  console.log(`\n🔎 Researching: "${query}" (depth: ${depth})\n`);
  const record = await research({
    query,
    depth,
    onProgress: (e) => console.log(`  [${e.phase}] ${e.message}`),
  });

  try {
    const rel = getResearchStore().save(record);
    console.log(`\n💾 Saved: ${rel}`);
  } catch (err) {
    console.error('  persist failed:', err);
  }

  console.log(`\n📄 SUMMARY\n${record.brief.summary}\n`);
  if (record.brief.keyPoints.length) {
    console.log('🔑 KEY POINTS');
    record.brief.keyPoints.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }
  if (record.brief.followUpQuestions.length) {
    console.log('\n➡  FOLLOW-UPS');
    record.brief.followUpQuestions.forEach((q) => console.log(`  • ${q}`));
  }
  console.log(`\n📚 SOURCES (${record.stats.sourcesFetched} used, ${record.stats.sourcesFailed} failed)`);
  record.sources.forEach((s) => {
    const marker = s.status === 'ok' ? '✓' : '✗';
    console.log(`  ${marker} [${s.id}] ${s.title} — ${s.url}`);
  });
  console.log(
    `\n⏱  ${record.stats.durationMs}ms · ${record.stats.totalCharsRead.toLocaleString()} chars · ${record.stats.model}\n`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
