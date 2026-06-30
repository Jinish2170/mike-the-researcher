import axios from 'axios';
import { CONFIG } from '../config';
import { ExtractedPage } from './readability';

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

interface VideoMetadata {
  title: string;
  author: string;
  description: string;
  lengthSeconds: number;
  viewCount: string;
  publishDate: string;
  keywords: string[];
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchVideoPage(videoId: string): Promise<string> {
  const resp = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: CONFIG.search.requestTimeoutMs,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  return resp.data;
}

function parseMetadataFromPage(html: string): VideoMetadata | null {
  try {
    const titleMatch = html.match(/"title":"((?:[^"\\]|\\.)*)"/);
    const authorMatch = html.match(/"author":"((?:[^"\\]|\\.)*)"/);
    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);
    const viewMatch = html.match(/"viewCount":"(\d+)"/);
    const dateMatch = html.match(/"publishDate":"([^"]+)"/);
    const kwMatch = html.match(/"keywords":\[([^\]]*)\]/);

    const keywords: string[] = [];
    if (kwMatch) {
      const kws = kwMatch[1].match(/"((?:[^"\\]|\\.)*)"/g);
      if (kws) kws.forEach((k) => keywords.push(k.replace(/"/g, '')));
    }

    return {
      title: titleMatch?.[1]?.replace(/\\"/g, '"') || 'Unknown',
      author: authorMatch?.[1]?.replace(/\\"/g, '"') || 'Unknown',
      description: (descMatch?.[1] || '').replace(/\\n/g, '\n').replace(/\\"/g, '"'),
      lengthSeconds: parseInt(lengthMatch?.[1] || '0'),
      viewCount: viewMatch?.[1] || '0',
      publishDate: dateMatch?.[1] || '',
      keywords: keywords.slice(0, 10),
    };
  } catch {
    return null;
  }
}

function parseTranscriptFromPage(html: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // Extract from playerCaptionsTracklistRenderer or timedtext
  const captionMatch = html.match(/"captionTracks":\[(\{[^}]*"baseUrl":"[^"]*"[^}]*\})/);
  if (!captionMatch) return segments;

  // We can't easily fetch the caption URL due to CORS/auth, so extract from the embedded data
  // Look for the transcript in the initial player response
  const transcriptMatch = html.match(/"transcriptBodyRenderer":\{"cueGroups":\[(.*?)\]\}/s);
  if (transcriptMatch) {
    const cueRegex = /"simpleText":"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = cueRegex.exec(transcriptMatch[1])) !== null) {
      segments.push({ text: match[1].replace(/\\"/g, '"'), start: 0, duration: 0 });
    }
  }

  return segments;
}

function extractChapters(description: string): { time: string; title: string }[] {
  const chapters: { time: string; title: string }[] = [];
  const chapterRegex = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]?\s*(.+)/g;
  let match;
  while ((match = chapterRegex.exec(description)) !== null) {
    chapters.push({ time: match[1], title: match[2].trim() });
  }
  return chapters;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function extractYouTube(url: string, _query: string): Promise<ExtractedPage> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Could not parse YouTube video ID from ${url}`);

  const html = await fetchVideoPage(videoId);
  const meta = parseMetadataFromPage(html);

  if (!meta) throw new Error(`Could not extract video metadata for ${videoId}`);

  const parts: string[] = [];
  parts.push(`# ${meta.title}`);
  parts.push(`Channel: ${meta.author}`);
  parts.push(`Duration: ${formatDuration(meta.lengthSeconds)}`);
  parts.push(`Views: ${parseInt(meta.viewCount).toLocaleString()}`);
  if (meta.publishDate) parts.push(`Published: ${meta.publishDate}`);
  if (meta.keywords.length) parts.push(`Tags: ${meta.keywords.join(', ')}`);
  parts.push('');

  // Description with chapter markers
  if (meta.description) {
    const chapters = extractChapters(meta.description);
    if (chapters.length > 0) {
      parts.push('## Chapters');
      for (const ch of chapters) {
        parts.push(`[${ch.time}] ${ch.title}`);
      }
      parts.push('');
    }

    parts.push('## Description');
    parts.push(meta.description);
    parts.push('');
  }

  // Transcript
  const transcript = parseTranscriptFromPage(html);
  if (transcript.length > 0) {
    parts.push('## Transcript');
    parts.push(transcript.map((s) => s.text).join(' '));
  }

  const fullText = parts.join('\n');

  return {
    url,
    title: meta.title,
    textContent: fullText.slice(0, CONFIG.search.maxContentChars),
    excerpt: meta.description.slice(0, 200),
    byline: meta.author,
    siteName: 'YouTube',
    length: fullText.length,
  };
}
