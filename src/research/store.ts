import fs from 'fs';
import path from 'path';
import { ResearchRecord, ResearchSummary } from '../types';

export interface ResearchStore {
  save(record: ResearchRecord): string;
  list(limit?: number): ResearchSummary[];
  get(id: string): ResearchRecord | null;
}

const ROOT = path.join(process.cwd(), 'research');

function sanitizeFilename(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function firstSentence(text: string): string {
  const match = text.match(/^(.+?[.!?])\s/);
  return match ? match[1] : text.slice(0, 120);
}

class FileResearchStore implements ResearchStore {
  save(record: ResearchRecord): string {
    const date = record.createdAt.slice(0, 10);
    const dir = path.join(ROOT, date);
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${sanitizeFilename(record.query)}__${record.id}.json`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return path.relative(process.cwd(), filePath);
  }

  list(limit = 50): ResearchSummary[] {
    if (!fs.existsSync(ROOT)) return [];

    const results: ResearchSummary[] = [];
    const dateDirs = fs.readdirSync(ROOT)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();

    for (const dateDir of dateDirs) {
      if (results.length >= limit) break;
      const dirPath = path.join(ROOT, dateDir);

      let files: string[];
      try {
        files = fs.readdirSync(dirPath)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse();
      } catch {
        continue;
      }

      for (const file of files) {
        if (results.length >= limit) break;
        try {
          const raw = fs.readFileSync(path.join(dirPath, file), 'utf-8');
          const rec: ResearchRecord = JSON.parse(raw);
          results.push({
            id: rec.id,
            query: rec.query,
            depth: rec.depth,
            createdAt: rec.createdAt,
            stats: rec.stats,
            oneLine: firstSentence(rec.brief.summary),
          });
        } catch {
          continue;
        }
      }
    }
    return results;
  }

  get(id: string): ResearchRecord | null {
    if (!fs.existsSync(ROOT)) return null;

    const dateDirs = fs.readdirSync(ROOT)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

    for (const dateDir of dateDirs) {
      const dirPath = path.join(ROOT, dateDir);
      let files: string[];
      try {
        files = fs.readdirSync(dirPath).filter((f) => f.includes(`__${id}.json`));
      } catch {
        continue;
      }

      if (files.length > 0) {
        try {
          const raw = fs.readFileSync(path.join(dirPath, files[0]), 'utf-8');
          return JSON.parse(raw) as ResearchRecord;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

let _store: ResearchStore | null = null;

export function getResearchStore(): ResearchStore {
  if (!_store) _store = new FileResearchStore();
  return _store;
}
