import axios from 'axios';
import { CONFIG } from '../config';
import { ExtractedPage } from './readability';

interface RedditComment {
  author: string;
  body: string;
  score: number;
  depth: number;
  replies: RedditComment[];
}

interface RedditPost {
  title: string;
  author: string;
  selftext: string;
  score: number;
  numComments: number;
  subreddit: string;
  created: number;
  url: string;
  permalink: string;
  flair?: string;
}

function parseRedditUrl(url: string): { subreddit: string; postId: string } | null {
  const match = url.match(/reddit\.com\/r\/([^/]+)\/comments\/([^/]+)/i);
  if (match) return { subreddit: match[1], postId: match[2] };
  const oldMatch = url.match(/old\.reddit\.com\/r\/([^/]+)\/comments\/([^/]+)/i);
  if (oldMatch) return { subreddit: oldMatch[1], postId: oldMatch[2] };
  return null;
}

function flattenComments(data: unknown[], depth = 0, maxDepth = 4): RedditComment[] {
  const comments: RedditComment[] = [];
  if (!Array.isArray(data)) return comments;

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const thing = item as Record<string, unknown>;
    if (thing.kind !== 't1') continue;

    const d = thing.data as Record<string, unknown>;
    if (!d || typeof d.body !== 'string') continue;
    if (d.body === '[deleted]' || d.body === '[removed]') continue;

    const comment: RedditComment = {
      author: String(d.author || '[deleted]'),
      body: d.body,
      score: typeof d.score === 'number' ? d.score : 0,
      depth,
      replies: [],
    };

    if (depth < maxDepth && d.replies && typeof d.replies === 'object') {
      const repliesObj = d.replies as Record<string, unknown>;
      if (repliesObj.data && typeof repliesObj.data === 'object') {
        const repliesData = repliesObj.data as Record<string, unknown>;
        if (Array.isArray(repliesData.children)) {
          comment.replies = flattenComments(repliesData.children, depth + 1, maxDepth);
        }
      }
    }

    comments.push(comment);
  }

  return comments;
}

function renderCommentTree(comments: RedditComment[], maxComments: number): string {
  const lines: string[] = [];
  let count = 0;

  function render(cs: RedditComment[]) {
    const sorted = [...cs].sort((a, b) => b.score - a.score);
    for (const c of sorted) {
      if (count >= maxComments) return;
      const indent = '  '.repeat(c.depth);
      const scoreLabel = c.score > 0 ? `+${c.score}` : String(c.score);
      lines.push(`${indent}[${scoreLabel}] u/${c.author}:`);
      lines.push(`${indent}${c.body.replace(/\n/g, `\n${indent}`)}`);
      lines.push('');
      count++;
      if (c.replies.length > 0) render(c.replies);
    }
  }

  render(comments);
  return lines.join('\n');
}

export async function extractReddit(url: string, _query: string): Promise<ExtractedPage> {
  const parsed = parseRedditUrl(url);
  if (!parsed) throw new Error(`Could not parse Reddit URL: ${url}`);

  // Use Reddit's JSON API (append .json)
  const jsonUrl = `https://www.reddit.com/r/${parsed.subreddit}/comments/${parsed.postId}.json`;

  const resp = await axios.get(jsonUrl, {
    headers: {
      'User-Agent': CONFIG.search.userAgent,
      Accept: 'application/json',
    },
    timeout: CONFIG.search.requestTimeoutMs,
  });

  const data = resp.data;
  if (!Array.isArray(data) || data.length < 1) {
    throw new Error('Reddit API returned unexpected format');
  }

  // First element: the post
  const postData = data[0]?.data?.children?.[0]?.data;
  if (!postData) throw new Error('Could not parse Reddit post data');

  const post: RedditPost = {
    title: postData.title || 'Reddit Post',
    author: postData.author || '[deleted]',
    selftext: postData.selftext || '',
    score: postData.score || 0,
    numComments: postData.num_comments || 0,
    subreddit: postData.subreddit || parsed.subreddit,
    created: postData.created_utc || 0,
    url: postData.url || url,
    permalink: postData.permalink || '',
    flair: postData.link_flair_text || undefined,
  };

  // Second element: comments
  const commentChildren = data[1]?.data?.children || [];
  const comments = flattenComments(commentChildren);

  // Build output
  const parts: string[] = [];
  parts.push(`# ${post.title}`);
  parts.push(`r/${post.subreddit} • u/${post.author} • Score: ${post.score} • ${post.numComments} comments`);
  if (post.flair) parts.push(`Flair: ${post.flair}`);
  const date = new Date(post.created * 1000);
  parts.push(`Posted: ${date.toISOString().slice(0, 10)}`);
  parts.push('');

  if (post.selftext) {
    parts.push('## Post');
    parts.push(post.selftext);
    parts.push('');
  }

  if (comments.length > 0) {
    parts.push(`## Top Comments (${Math.min(comments.length, 15)} of ${post.numComments})`);
    parts.push(renderCommentTree(comments, 15));
  }

  const fullText = parts.join('\n');

  return {
    url,
    title: post.title,
    textContent: fullText.slice(0, CONFIG.search.maxContentChars),
    excerpt: (post.selftext || comments[0]?.body || '').slice(0, 200),
    siteName: `Reddit r/${post.subreddit}`,
    byline: `u/${post.author}`,
    length: fullText.length,
  };
}
