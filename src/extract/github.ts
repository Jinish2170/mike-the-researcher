import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { CONFIG } from '../config';
import { ExtractedPage, selectRelevantContent } from './readability';

interface GitHubParsed {
  owner: string;
  repo: string;
  type: 'repo' | 'issue' | 'pull' | 'discussion' | 'blob' | 'tree' | 'other';
  number?: number;
  path?: string;
  ref?: string;
}

function parseGitHubUrl(url: string): GitHubParsed | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/i);
  if (!match) return null;

  const [, owner, rawRepo, segment, rest] = match;
  const repo = rawRepo.replace(/\.git$/, '');

  if (!segment) return { owner, repo, type: 'repo' };

  if (segment === 'issues' && rest) return { owner, repo, type: 'issue', number: parseInt(rest) };
  if (segment === 'pull' && rest) return { owner, repo, type: 'pull', number: parseInt(rest) };
  if (segment === 'discussions' && rest) return { owner, repo, type: 'discussion', number: parseInt(rest) };
  if (segment === 'blob' || segment === 'tree') {
    const pathMatch = url.match(/\/(blob|tree)\/([^/]+)\/(.*)/);
    return {
      owner,
      repo,
      type: segment as 'blob' | 'tree',
      ref: pathMatch?.[2],
      path: pathMatch?.[3],
    };
  }

  return { owner, repo, type: 'other' };
}

async function fetchRawContent(owner: string, repo: string, path: string, ref = 'HEAD'): Promise<string | null> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    const resp = await axios.get(rawUrl, {
      headers: { 'User-Agent': CONFIG.search.userAgent },
      timeout: CONFIG.search.requestTimeoutMs,
      responseType: 'text',
    });
    return typeof resp.data === 'string' ? resp.data : null;
  } catch {
    return null;
  }
}

async function fetchReadme(owner: string, repo: string): Promise<string | null> {
  for (const name of ['README.md', 'readme.md', 'README.rst', 'README', 'README.txt']) {
    const content = await fetchRawContent(owner, repo, name);
    if (content) return content;
  }
  return null;
}

async function fetchRepoMetadata(owner: string, repo: string): Promise<string> {
  try {
    const resp = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'User-Agent': CONFIG.search.userAgent,
        Accept: 'application/vnd.github.v3+json',
      },
      timeout: CONFIG.search.requestTimeoutMs,
    });
    const d = resp.data;
    const parts: string[] = [];
    if (d.description) parts.push(`Description: ${d.description}`);
    if (d.language) parts.push(`Primary language: ${d.language}`);
    if (d.stargazers_count != null) parts.push(`Stars: ${d.stargazers_count.toLocaleString()}`);
    if (d.forks_count != null) parts.push(`Forks: ${d.forks_count.toLocaleString()}`);
    if (d.topics?.length) parts.push(`Topics: ${d.topics.join(', ')}`);
    if (d.license?.spdx_id) parts.push(`License: ${d.license.spdx_id}`);
    if (d.created_at) parts.push(`Created: ${d.created_at.slice(0, 10)}`);
    if (d.updated_at) parts.push(`Last updated: ${d.updated_at.slice(0, 10)}`);
    return parts.join('\n');
  } catch {
    return '';
  }
}

async function extractIssueOrPR(url: string): Promise<ExtractedPage> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      Accept: 'text/html',
    },
    timeout: CONFIG.search.requestTimeoutMs,
    responseType: 'text',
    transformResponse: [(data) => data],
  });

  const dom = new JSDOM(response.data, { url });
  const doc = dom.window.document;

  const titleEl = doc.querySelector('.js-issue-title, .gh-header-title');
  const title = titleEl?.textContent?.trim() || 'GitHub Issue';

  const bodyEl = doc.querySelector('.comment-body, .markdown-body');
  const bodyText = bodyEl?.textContent?.trim() || '';

  const comments: string[] = [];
  const commentEls = doc.querySelectorAll('.timeline-comment .comment-body');
  commentEls.forEach((el, i) => {
    if (i > 0 && i <= 10) {
      const text = el.textContent?.trim();
      if (text) comments.push(`--- Comment ${i} ---\n${text}`);
    }
  });

  const fullText = [bodyText, ...comments].join('\n\n');

  return {
    url,
    title,
    textContent: fullText.slice(0, CONFIG.search.maxContentChars),
    excerpt: bodyText.slice(0, 200),
    siteName: 'GitHub',
    length: fullText.length,
  };
}

export async function extractGitHubContent(url: string, query: string): Promise<ExtractedPage> {
  const parsed = parseGitHubUrl(url);

  if (!parsed) {
    const response = await axios.get(url, {
      headers: { 'User-Agent': CONFIG.search.userAgent, Accept: 'text/html' },
      timeout: CONFIG.search.requestTimeoutMs,
      responseType: 'text',
      transformResponse: [(data) => data],
    });
    const dom = new JSDOM(response.data, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return {
      url,
      title: article?.title || url,
      textContent: (article?.textContent || '').slice(0, CONFIG.search.maxContentChars),
      excerpt: article?.excerpt || '',
      siteName: 'GitHub',
      length: article?.textContent?.length || 0,
    };
  }

  if (parsed.type === 'issue' || parsed.type === 'pull' || parsed.type === 'discussion') {
    return extractIssueOrPR(url);
  }

  if (parsed.type === 'blob' && parsed.path) {
    const raw = await fetchRawContent(parsed.owner, parsed.repo, parsed.path, parsed.ref);
    if (raw) {
      const ext = parsed.path.split('.').pop() || '';
      const isCode = ['ts', 'js', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'sh', 'yaml', 'yml', 'json', 'toml', 'css', 'html', 'sql'].includes(ext);
      const formatted = isCode ? `\`\`\`${ext}\n${raw}\n\`\`\`` : raw;
      return {
        url,
        title: `${parsed.owner}/${parsed.repo}: ${parsed.path}`,
        textContent: selectRelevantContent(formatted, query, CONFIG.search.maxContentChars),
        excerpt: raw.slice(0, 200),
        siteName: 'GitHub',
        length: raw.length,
      };
    }
  }

  // Repository root — fetch metadata + README
  const parts: string[] = [];

  const meta = await fetchRepoMetadata(parsed.owner, parsed.repo);
  if (meta) parts.push(`# ${parsed.owner}/${parsed.repo}\n${meta}`);

  const readme = await fetchReadme(parsed.owner, parsed.repo);
  if (readme) parts.push(`\n## README\n${readme}`);

  const fullText = parts.join('\n\n');
  if (!fullText.trim()) {
    throw new Error(`Could not extract content from GitHub: ${url}`);
  }

  return {
    url,
    title: `${parsed.owner}/${parsed.repo}`,
    textContent: selectRelevantContent(fullText, query, CONFIG.search.maxContentChars),
    excerpt: (meta || readme || '').slice(0, 200),
    siteName: 'GitHub',
    length: fullText.length,
  };
}
