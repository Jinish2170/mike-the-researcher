import axios from 'axios';
import { CONFIG } from '../config';
import { ExtractedPage } from './readability';

interface SOAnswer {
  body: string;
  score: number;
  isAccepted: boolean;
  author: string;
  createdAt: string;
}

interface SOQuestion {
  title: string;
  body: string;
  score: number;
  tags: string[];
  author: string;
  createdAt: string;
  viewCount: number;
  answerCount: number;
  answers: SOAnswer[];
}

function parseSOUrl(url: string): { site: string; questionId: string } | null {
  // stackoverflow.com/questions/12345/...
  // stackexchange.com sites: serverfault.com, superuser.com, *.stackexchange.com
  const soMatch = url.match(/(stackoverflow|serverfault|superuser|[a-z]+\.stackexchange)\.com\/questions\/(\d+)/i);
  if (soMatch) {
    const site = soMatch[1].includes('stackexchange')
      ? soMatch[1].replace('.stackexchange', '')
      : soMatch[1];
    return { site, questionId: soMatch[2] };
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
      return '\n```\n' + decodeHtmlEntities(code) + '\n```\n';
    })
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_, code) => '`' + decodeHtmlEntities(code) + '`')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export async function extractStackOverflow(url: string, _query: string): Promise<ExtractedPage> {
  const parsed = parseSOUrl(url);
  if (!parsed) throw new Error(`Could not parse StackOverflow URL: ${url}`);

  const apiSite = parsed.site === 'stackoverflow' ? 'stackoverflow' : parsed.site;
  const apiUrl = `https://api.stackexchange.com/2.3/questions/${parsed.questionId}?order=desc&sort=votes&site=${apiSite}&filter=withbody`;

  const qResp = await axios.get(apiUrl, {
    headers: { 'User-Agent': CONFIG.search.userAgent, 'Accept-Encoding': 'gzip' },
    timeout: CONFIG.search.requestTimeoutMs,
    decompress: true,
  });

  const qData = qResp.data?.items?.[0];
  if (!qData) throw new Error(`StackExchange API returned no data for question ${parsed.questionId}`);

  // Fetch answers separately with body
  const answersUrl = `https://api.stackexchange.com/2.3/questions/${parsed.questionId}/answers?order=desc&sort=votes&site=${apiSite}&filter=withbody&pagesize=5`;
  let answers: SOAnswer[] = [];

  try {
    const aResp = await axios.get(answersUrl, {
      headers: { 'User-Agent': CONFIG.search.userAgent, 'Accept-Encoding': 'gzip' },
      timeout: CONFIG.search.requestTimeoutMs,
      decompress: true,
    });

    answers = (aResp.data?.items || []).map((a: Record<string, unknown>) => ({
      body: stripHtml(String(a.body || '')),
      score: typeof a.score === 'number' ? a.score : 0,
      isAccepted: Boolean(a.is_accepted),
      author: (a.owner as Record<string, string>)?.display_name || 'anonymous',
      createdAt: new Date(Number(a.creation_date) * 1000).toISOString().slice(0, 10),
    }));
  } catch {
    // Continue without answers
  }

  const question: SOQuestion = {
    title: qData.title || 'Question',
    body: stripHtml(String(qData.body || '')),
    score: qData.score || 0,
    tags: qData.tags || [],
    author: qData.owner?.display_name || 'anonymous',
    createdAt: new Date((qData.creation_date || 0) * 1000).toISOString().slice(0, 10),
    viewCount: qData.view_count || 0,
    answerCount: qData.answer_count || 0,
    answers,
  };

  // Build structured output
  const parts: string[] = [];
  parts.push(`# ${decodeHtmlEntities(question.title)}`);
  parts.push(`Score: ${question.score} | Views: ${question.viewCount.toLocaleString()} | Answers: ${question.answerCount}`);
  parts.push(`Tags: ${question.tags.join(', ')}`);
  parts.push(`Asked by ${question.author} on ${question.createdAt}`);
  parts.push('');
  parts.push('## Question');
  parts.push(question.body);

  if (question.answers.length > 0) {
    // Put accepted answer first
    const sorted = [...question.answers].sort((a, b) => {
      if (a.isAccepted !== b.isAccepted) return a.isAccepted ? -1 : 1;
      return b.score - a.score;
    });

    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const tag = a.isAccepted ? ' ✓ ACCEPTED' : '';
      parts.push('');
      parts.push(`## Answer ${i + 1} (Score: ${a.score}${tag}) — ${a.author}`);
      parts.push(a.body);
    }
  }

  const fullText = parts.join('\n');

  return {
    url,
    title: decodeHtmlEntities(question.title),
    textContent: fullText.slice(0, CONFIG.search.maxContentChars),
    excerpt: question.body.slice(0, 200),
    siteName: 'Stack Overflow',
    byline: question.author,
    length: fullText.length,
  };
}
