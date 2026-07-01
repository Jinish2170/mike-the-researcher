// Offline parser tests — validate extraction logic without network calls
// Uses mock HTML/JSON to test each extractor's parsing correctness

import { JSDOM } from 'jsdom';

// ── Helper ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Wikipedia HTML parsing ─────────────────────────────────────
function testWikipediaParsing() {
  console.log('\n=== WIKIPEDIA PARSER ===\n');

  const html = `<html><body>
    <h2 id="History">History</h2>
    <p>AI research began in the 1950s at Dartmouth College.</p>
    <p>Early systems used symbolic reasoning and logic.</p>
    <h2 id="Applications">Applications</h2>
    <p>AI is used in healthcare, finance, and autonomous vehicles.</p>
    <ul><li>Natural language processing</li><li>Computer vision</li></ul>
    <h2 id="References">References</h2>
    <p>Bibliography entries here.</p>
    <h2 id="See_also">See also</h2>
    <p>Related topics here.</p>
  </body></html>`;

  const dom = new JSDOM(html, { url: 'https://en.wikipedia.org/wiki/AI' });
  const doc = dom.window.document;

  // Extract sections (same logic as wikipedia.ts)
  const sections: { title: string; level: number; content: string }[] = [];
  const headings = doc.querySelectorAll('h2, h3, h4');
  headings.forEach((h) => {
    const id = h.id || h.textContent?.trim() || '';
    const level = parseInt(h.tagName.slice(1));
    let content = '';
    let sibling = h.nextElementSibling;
    while (sibling && !['H2', 'H3', 'H4'].includes(sibling.tagName)) {
      if (['P', 'UL', 'OL'].includes(sibling.tagName)) {
        content += (sibling.textContent || '').trim() + '\n';
      }
      sibling = sibling.nextElementSibling;
    }
    if (content.trim()) {
      sections.push({ title: id, level, content: content.trim() });
    }
  });

  assert(sections.length === 4, `Found ${sections.length} sections`, 'expected 4');
  assert(sections[0].title === 'History', 'First section is "History"');
  assert(sections[0].content.includes('1950s'), 'History content mentions 1950s');
  assert(sections[1].title === 'Applications', 'Second section is "Applications"');

  // Filter skip sections (same logic as wikipedia.ts)
  const skipSections = /references|see[_ ]also|external[_ ]links|further[_ ]reading|notes|bibliography/i;
  const filtered = sections.filter((s) => !skipSections.test(s.title));
  assert(filtered.length === 2, `After filtering: ${filtered.length} sections`, 'expected 2 (History + Applications)');
}

// ── GitHub URL parsing ─────────────────────────────────────────
function testGitHubUrlParsing() {
  console.log('\n=== GITHUB URL PARSER ===\n');

  function parseGitHubUrl(url: string) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/i);
    if (!match) return null;
    const [, owner, rawRepo, segment, rest] = match;
    const repo = rawRepo.replace(/\.git$/, '');
    if (!segment) return { owner, repo, type: 'repo' };
    if (segment === 'issues' && rest) return { owner, repo, type: 'issue', number: parseInt(rest) };
    if (segment === 'pull' && rest) return { owner, repo, type: 'pull', number: parseInt(rest) };
    if (segment === 'blob' || segment === 'tree') return { owner, repo, type: segment };
    return { owner, repo, type: 'other' };
  }

  const r1 = parseGitHubUrl('https://github.com/microsoft/TypeScript');
  assert(r1?.type === 'repo', 'Repo root detected');
  assert(r1?.owner === 'microsoft', 'Owner parsed');
  assert(r1?.repo === 'TypeScript', 'Repo name parsed');

  const r2 = parseGitHubUrl('https://github.com/facebook/react/issues/123');
  assert(r2?.type === 'issue', 'Issue detected');
  assert(r2?.number === 123, 'Issue number parsed');

  const r3 = parseGitHubUrl('https://github.com/org/repo/pull/456');
  assert(r3?.type === 'pull', 'PR detected');
  assert(r3?.number === 456, 'PR number parsed');

  const r4 = parseGitHubUrl('https://github.com/org/repo/blob/main/src/index.ts');
  assert(r4?.type === 'blob', 'Blob detected');

  const r5 = parseGitHubUrl('https://github.com/org/repo.git');
  assert(r5?.repo === 'repo', '.git suffix stripped');

  const r6 = parseGitHubUrl('https://example.com/not-github');
  assert(r6 === null, 'Non-GitHub URL returns null');
}

// ── arXiv ID extraction ────────────────────────────────────────
function testArxivIdExtraction() {
  console.log('\n=== ARXIV ID PARSER ===\n');

  function extractArxivId(url: string): string | null {
    const match = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    return match ? match[1] : null;
  }

  assert(extractArxivId('https://arxiv.org/abs/2301.12345') === '2301.12345', 'abs URL');
  assert(extractArxivId('https://arxiv.org/pdf/2301.12345') === '2301.12345', 'pdf URL');
  assert(extractArxivId('https://arxiv.org/html/2301.12345') === '2301.12345', 'html URL');
  assert(extractArxivId('https://arxiv.org/abs/2301.12345v2') === '2301.12345v2', 'versioned URL');
  assert(extractArxivId('https://arxiv.org/abs/1706.03762') === '1706.03762', 'old-style ID');
  assert(extractArxivId('https://example.com/page') === null, 'non-arXiv returns null');
}

// ── arXiv XML metadata parsing ─────────────────────────────────
function testArxivXmlParsing() {
  console.log('\n=== ARXIV XML PARSER ===\n');

  const xml = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Attention Is All You Need</title>
      <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
      <author><name>Ashish Vaswani</name></author>
      <author><name>Noam Shazeer</name></author>
      <author><name>Niki Parmar</name></author>
      <published>2017-06-12T17:57:34Z</published>
      <updated>2023-08-02T00:00:00Z</updated>
      <category term="cs.CL"/>
      <category term="cs.LG"/>
      <comment>15 pages, 5 figures</comment>
    </entry>
  </feed>`;

  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  const doc = dom.window.document;
  const entry = doc.querySelector('entry');

  assert(entry !== null, 'Entry found');
  const title = entry!.querySelector('title')?.textContent?.trim();
  assert(title === 'Attention Is All You Need', `Title: ${title}`);

  const authors: string[] = [];
  entry!.querySelectorAll('author name').forEach((el) => {
    const name = el.textContent?.trim();
    if (name) authors.push(name);
  });
  assert(authors.length === 3, `Found ${authors.length} authors`);
  assert(authors[0] === 'Ashish Vaswani', `First author: ${authors[0]}`);

  const categories: string[] = [];
  entry!.querySelectorAll('category').forEach((el) => {
    const term = el.getAttribute('term');
    if (term) categories.push(term);
  });
  assert(categories.length === 2, `Found ${categories.length} categories`);
  assert(categories.includes('cs.CL'), 'Has cs.CL category');

  const comment = entry!.querySelector('comment')?.textContent?.trim();
  assert(comment === '15 pages, 5 figures', `Comment: ${comment}`);
}

// ── Reddit URL parsing ─────────────────────────────────────────
function testRedditUrlParsing() {
  console.log('\n=== REDDIT URL PARSER ===\n');

  function parseRedditUrl(url: string) {
    const match = url.match(/(?:reddit\.com|old\.reddit\.com)\/r\/([^/]+)\/comments\/([^/]+)/i);
    if (match) return { subreddit: match[1], postId: match[2] };
    return null;
  }

  const r1 = parseRedditUrl('https://www.reddit.com/r/MachineLearning/comments/abc123/title_of_post/');
  assert(r1?.subreddit === 'MachineLearning', `Subreddit: ${r1?.subreddit}`);
  assert(r1?.postId === 'abc123', `Post ID: ${r1?.postId}`);

  const r2 = parseRedditUrl('https://old.reddit.com/r/programming/comments/xyz789/another/');
  assert(r2?.subreddit === 'programming', 'old.reddit parsed');
  assert(r2?.postId === 'xyz789', 'Post ID from old.reddit');

  const r3 = parseRedditUrl('https://reddit.com/r/AskReddit/');
  assert(r3 === null, 'Subreddit page (no post) returns null');
}

// ── Reddit comment tree flattening ─────────────────────────────
function testRedditCommentParsing() {
  console.log('\n=== REDDIT COMMENT PARSER ===\n');

  const commentData = [
    {
      kind: 't1',
      data: {
        author: 'user1',
        body: 'This is a great post!',
        score: 42,
        replies: {
          data: {
            children: [
              {
                kind: 't1',
                data: { author: 'user2', body: 'I agree completely', score: 15, replies: '' },
              },
            ],
          },
        },
      },
    },
    {
      kind: 't1',
      data: { author: 'user3', body: '[deleted]', score: 0, replies: '' },
    },
    {
      kind: 't1',
      data: { author: 'user4', body: 'Another perspective here', score: 8, replies: '' },
    },
  ];

  // Inline comment flattening (same logic as reddit.ts)
  function flattenComments(data: unknown[], depth = 0): { author: string; body: string; score: number; depth: number }[] {
    const comments: { author: string; body: string; score: number; depth: number }[] = [];
    for (const item of data) {
      const thing = item as Record<string, unknown>;
      if (thing.kind !== 't1') continue;
      const d = thing.data as Record<string, unknown>;
      if (!d || typeof d.body !== 'string') continue;
      if (d.body === '[deleted]' || d.body === '[removed]') continue;
      comments.push({
        author: String(d.author),
        body: d.body,
        score: typeof d.score === 'number' ? d.score : 0,
        depth,
      });
      if (d.replies && typeof d.replies === 'object') {
        const repliesObj = d.replies as Record<string, unknown>;
        if (repliesObj.data && typeof repliesObj.data === 'object') {
          const repliesData = repliesObj.data as Record<string, unknown>;
          if (Array.isArray(repliesData.children)) {
            comments.push(...flattenComments(repliesData.children, depth + 1));
          }
        }
      }
    }
    return comments;
  }

  const flat = flattenComments(commentData);
  assert(flat.length === 3, `${flat.length} comments after filtering [deleted]`, 'expected 3');
  assert(flat[0].author === 'user1', 'First comment from user1');
  assert(flat[0].score === 42, 'Score preserved');
  assert(flat[1].depth === 1, 'Reply has depth 1');
  assert(flat[1].body === 'I agree completely', 'Reply body correct');
  assert(!flat.find((c) => c.body === '[deleted]'), '[deleted] comments filtered');
}

// ── StackOverflow HTML stripping ───────────────────────────────
function testSOHtmlStripping() {
  console.log('\n=== STACKOVERFLOW HTML STRIPPER ===\n');

  function decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
  }

  function stripHtml(html: string): string {
    const result = html
      .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) =>
        '\n```\n' + decodeEntities(code) + '\n```\n')
      .replace(/<code>([\s\S]*?)<\/code>/gi, (_, code) =>
        '`' + decodeEntities(code) + '`')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<li>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p>/gi, '\n')
      .replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return decodeEntities(result);
  }

  const r1 = stripHtml('<p>Use <code>git reset</code> to undo commits.</p>');
  assert(r1.includes('`git reset`'), `Inline code: ${r1}`);

  const r2 = stripHtml('<pre><code class="lang-js">const x = 1;\nconst y = 2;</code></pre>');
  assert(r2.includes('```'), 'Code block has fences');
  assert(r2.includes('const x = 1;'), 'Code content preserved');

  const r3 = stripHtml('<a href="https://example.com">click here</a>');
  assert(r3 === '[click here](https://example.com)', `Link: ${r3}`);

  const r4 = stripHtml('<ul><li>item 1</li><li>item 2</li></ul>');
  assert(r4.includes('• item 1'), 'List items converted');

  const r5 = stripHtml('x &lt; y &amp;&amp; y &gt; z');
  assert(r5.includes('x < y'), `Entities decoded: ${r5}`);
}

// ── StackOverflow URL parsing ──────────────────────────────────
function testSOUrlParsing() {
  console.log('\n=== STACKOVERFLOW URL PARSER ===\n');

  function parseSOUrl(url: string) {
    const match = url.match(/(stackoverflow|serverfault|superuser|[a-z]+\.stackexchange)\.com\/questions\/(\d+)/i);
    if (match) {
      const site = match[1].includes('stackexchange') ? match[1].replace('.stackexchange', '') : match[1];
      return { site, questionId: match[2] };
    }
    return null;
  }

  const r1 = parseSOUrl('https://stackoverflow.com/questions/12345/how-to-do-x');
  assert(r1?.site === 'stackoverflow', `Site: ${r1?.site}`);
  assert(r1?.questionId === '12345', `ID: ${r1?.questionId}`);

  const r2 = parseSOUrl('https://serverfault.com/questions/999/something');
  assert(r2?.site === 'serverfault', `Site: ${r2?.site}`);

  const r3 = parseSOUrl('https://math.stackexchange.com/questions/555/problem');
  assert(r3?.site === 'math', `Site: ${r3?.site}`);

  const r4 = parseSOUrl('https://example.com/questions/1');
  assert(r4 === null, 'Non-SE URL returns null');
}

// ── YouTube video ID extraction ────────────────────────────────
function testYouTubeIdExtraction() {
  console.log('\n=== YOUTUBE ID PARSER ===\n');

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

  assert(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'Standard watch URL');
  assert(extractVideoId('https://youtu.be/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'Short URL');
  assert(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ') === 'dQw4w9WgXcQ', 'Embed URL');
  assert(extractVideoId('https://www.youtube.com/shorts/ABC12345678') === 'ABC12345678', 'Shorts URL');
  assert(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120') === 'dQw4w9WgXcQ', 'URL with params');
  assert(extractVideoId('https://example.com/video') === null, 'Non-YouTube URL');
}

// ── YouTube metadata parsing from HTML ─────────────────────────
function testYouTubeMetaParsing() {
  console.log('\n=== YOUTUBE METADATA PARSER ===\n');

  // Simulate the embedded JSON in YouTube's HTML
  const fakeHtml = `
    <html><body><script>
      var ytInitialPlayerResponse = {
        "videoDetails": {
          "title":"Understanding Transformers in 10 Minutes",
          "author":"Tech Channel",
          "shortDescription":"A quick guide to transformers in NLP.\\nCovers attention, encoder-decoder, and BERT.",
          "lengthSeconds":"600",
          "viewCount":"1500000",
          "keywords":["transformers","NLP","AI","deep learning"]
        },
        "publishDate":"2024-03-15"
      };
    </script></body></html>`;

  function parseMetadata(html: string) {
    const titleMatch = html.match(/"title":"((?:[^"\\]|\\.)*)"/);
    const authorMatch = html.match(/"author":"((?:[^"\\]|\\.)*)"/);
    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);
    const viewMatch = html.match(/"viewCount":"(\d+)"/);
    const dateMatch = html.match(/"publishDate":"([^"]+)"/);

    return {
      title: titleMatch?.[1] || '',
      author: authorMatch?.[1] || '',
      description: (descMatch?.[1] || '').replace(/\\n/g, '\n'),
      lengthSeconds: parseInt(lengthMatch?.[1] || '0'),
      viewCount: viewMatch?.[1] || '0',
      publishDate: dateMatch?.[1] || '',
    };
  }

  const meta = parseMetadata(fakeHtml);
  assert(meta.title === 'Understanding Transformers in 10 Minutes', `Title: ${meta.title}`);
  assert(meta.author === 'Tech Channel', `Author: ${meta.author}`);
  assert(meta.description.includes('attention'), 'Description has content');
  assert(meta.description.includes('\n'), 'Newlines decoded');
  assert(meta.lengthSeconds === 600, `Duration: ${meta.lengthSeconds}s`);
  assert(meta.viewCount === '1500000', `Views: ${meta.viewCount}`);
  assert(meta.publishDate === '2024-03-15', `Date: ${meta.publishDate}`);
}

// ── YouTube chapter extraction ─────────────────────────────────
function testYouTubeChapters() {
  console.log('\n=== YOUTUBE CHAPTER PARSER ===\n');

  function extractChapters(description: string) {
    const chapters: { time: string; title: string }[] = [];
    const re = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]?\s*(.+)/g;
    let match;
    while ((match = re.exec(description)) !== null) {
      chapters.push({ time: match[1], title: match[2].trim() });
    }
    return chapters;
  }

  const desc = `In this video we cover:
0:00 Introduction
2:30 - What are Transformers?
5:15 – Self-Attention Explained
8:00 — Practical Applications
1:02:30 Conclusion and Next Steps`;

  const chapters = extractChapters(desc);
  assert(chapters.length === 5, `Found ${chapters.length} chapters`);
  assert(chapters[0].time === '0:00', `First chapter time: ${chapters[0].time}`);
  assert(chapters[0].title === 'Introduction', `First chapter: ${chapters[0].title}`);
  assert(chapters[2].title === 'Self-Attention Explained', `Third chapter: ${chapters[2].title}`);
  assert(chapters[4].time === '1:02:30', `Long timestamp: ${chapters[4].time}`);
}

// ── News domain detection ──────────────────────────────────────
function testNewsDomainDetection() {
  console.log('\n=== NEWS DOMAIN DETECTION ===\n');

  const NEWS_DOMAINS = new Set([
    'nytimes.com', 'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'reuters.com',
    'apnews.com', 'cnn.com', 'theguardian.com', 'npr.org', 'wsj.com',
    'bloomberg.com', 'forbes.com', 'cnbc.com', 'arstechnica.com', 'wired.com',
    'techcrunch.com', 'theverge.com', 'vice.com', 'vox.com', 'politico.com',
  ]);

  function isNewsUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return NEWS_DOMAINS.has(hostname);
    } catch { return false; }
  }

  assert(isNewsUrl('https://www.nytimes.com/2024/01/01/article'), 'NYTimes detected');
  assert(isNewsUrl('https://techcrunch.com/2024/startup/'), 'TechCrunch detected');
  assert(isNewsUrl('https://www.bbc.com/news/tech-123'), 'BBC detected');
  assert(isNewsUrl('https://arstechnica.com/science/story/'), 'Ars Technica detected');
  assert(!isNewsUrl('https://example.com/news/'), 'Generic site not detected');
  assert(!isNewsUrl('https://medium.com/article'), 'Medium not detected as news');
}

// ── News content cleaning ──────────────────────────────────────
function testNewsContentCleaning() {
  console.log('\n=== NEWS CONTENT CLEANER ===\n');

  function cleanNewsContent(text: string): string {
    return text
      .replace(/Advertisement\s*/gi, '')
      .replace(/Subscribe to .*?\n/gi, '')
      .replace(/Sign up for .*?\n/gi, '')
      .replace(/\[.*?Getty Images.*?\]/gi, '')
      .replace(/\[.*?AP Photo.*?\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const dirty = `Breaking news about AI. Advertisement The company announced plans.
Subscribe to our newsletter for updates
[Photo credit: Getty Images]
Sign up for breaking alerts
Real content continues here.`;

  const clean = cleanNewsContent(dirty);
  assert(!clean.includes('Advertisement'), 'Ads removed');
  assert(!clean.includes('Subscribe to'), 'Subscribe prompts removed');
  assert(!clean.includes('Getty Images'), 'Photo credits removed');
  assert(!clean.includes('Sign up for'), 'Sign up prompts removed');
  assert(clean.includes('Real content continues'), 'Real content preserved');
  assert(clean.includes('Breaking news'), 'Opening content preserved');
}

// ── JSON-LD parsing ────────────────────────────────────────────
function testJsonLdParsing() {
  console.log('\n=== JSON-LD PARSER ===\n');

  const html = `<html><head>
    <meta property="og:title" content="Test Article">
    <meta property="og:description" content="This is an OG description">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Test Publisher">
    <meta name="author" content="John Doe">
    <meta name="twitter:title" content="Test Tweet Title">
    <script type="application/ld+json">
    {
      "@type": "Article",
      "headline": "Test LD Article",
      "description": "LD description",
      "datePublished": "2024-01-15",
      "author": { "@type": "Person", "name": "Jane Smith" },
      "publisher": { "@type": "Organization", "name": "LD Publisher" }
    }
    </script>
    <script type="application/ld+json">
    {
      "@type": "FAQPage",
      "mainEntity": [
        { "name": "What is AI?", "acceptedAnswer": { "text": "AI is artificial intelligence." } },
        { "name": "What is ML?", "acceptedAnswer": { "text": "ML is machine learning." } }
      ]
    }
    </script>
  </head><body></body></html>`;

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Test JSON-LD extraction
  const jsonLdItems: Record<string, unknown>[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try { jsonLdItems.push(JSON.parse(el.textContent || '')); } catch { /* skip */ }
  });
  assert(jsonLdItems.length === 2, `Found ${jsonLdItems.length} JSON-LD blocks`);
  assert(jsonLdItems[0]['@type'] === 'Article', 'Article type detected');
  assert(jsonLdItems[1]['@type'] === 'FAQPage', 'FAQ type detected');

  // Test OpenGraph extraction
  const og: Record<string, string> = {};
  doc.querySelectorAll('meta[property^="og:"]').forEach((el) => {
    const prop = (el.getAttribute('property') || '').replace('og:', '');
    const content = el.getAttribute('content') || '';
    if (prop && content) og[prop] = content;
  });
  assert(og.title === 'Test Article', `OG title: ${og.title}`);
  assert(og.site_name === 'Test Publisher', `OG site: ${og.site_name}`);

  // Test FAQ extraction
  const faqPage = jsonLdItems[1] as Record<string, unknown>;
  const mainEntity = faqPage.mainEntity as Record<string, unknown>[];
  assert(mainEntity.length === 2, `${mainEntity.length} FAQ items`);
  assert(mainEntity[0].name === 'What is AI?', `FAQ question: ${mainEntity[0].name}`);
}

// ── PDF URL detection ──────────────────────────────────────────
function testPdfUrlDetection() {
  console.log('\n=== PDF URL DETECTION ===\n');

  function isPdfUrl(url: string): boolean {
    return /\.pdf(\?|#|$)/i.test(url) || url.includes('/pdf/');
  }

  assert(isPdfUrl('https://example.com/paper.pdf'), 'Direct PDF');
  assert(isPdfUrl('https://example.com/paper.PDF'), 'Case insensitive');
  assert(isPdfUrl('https://example.com/paper.pdf?v=2'), 'PDF with query params');
  assert(isPdfUrl('https://example.com/paper.pdf#page=5'), 'PDF with hash');
  assert(!isPdfUrl('https://example.com/page.html'), 'HTML not detected');
  assert(!isPdfUrl('https://example.com/pdfviewer'), 'pdfviewer path not detected');
}

// ── Structured data extraction ─────────────────────────────────
function testStructuredDataExtraction() {
  console.log('\n=== STRUCTURED DATA PARSER ===\n');

  const html = `<html><body>
    <table>
      <caption>AI Model Comparison</caption>
      <thead><tr><th>Model</th><th>Parameters</th><th>Score</th></tr></thead>
      <tbody>
        <tr><td>GPT-4</td><td>1.7T</td><td>86.4</td></tr>
        <tr><td>Claude</td><td>Unknown</td><td>85.2</td></tr>
        <tr><td>Gemini</td><td>1.5T</td><td>84.1</td></tr>
      </tbody>
    </table>
    <main>
      <ul>
        <li>Natural language processing advances rapidly</li>
        <li>Computer vision has reached human-level accuracy</li>
        <li>Reinforcement learning enables game-playing agents</li>
      </ul>
      <p>The market for AI is worth $150 billion globally as of 2024.</p>
      <p>Revenue grew 35% year over year.</p>
    </main>
  </body></html>`;

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Table extraction
  const tables: { headers: string[]; rows: string[][]; caption?: string }[] = [];
  doc.querySelectorAll('table').forEach((table) => {
    const caption = table.querySelector('caption')?.textContent?.trim();
    const headers: string[] = [];
    table.querySelector('thead tr')?.querySelectorAll('th').forEach((th) => {
      headers.push(th.textContent?.trim() || '');
    });
    const rows: string[][] = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll('td').forEach((td) => cells.push(td.textContent?.trim() || ''));
      rows.push(cells);
    });
    tables.push({ headers, rows, caption });
  });

  assert(tables.length === 1, '1 table found');
  assert(tables[0].caption === 'AI Model Comparison', `Caption: ${tables[0].caption}`);
  assert(tables[0].headers.length === 3, '3 columns');
  assert(tables[0].rows.length === 3, '3 data rows');
  assert(tables[0].rows[0][0] === 'GPT-4', `First cell: ${tables[0].rows[0][0]}`);

  // List extraction
  const lists: string[][] = [];
  doc.querySelectorAll('main ul, main ol').forEach((list) => {
    const items: string[] = [];
    list.querySelectorAll(':scope > li').forEach((li) => {
      const text = (li.textContent || '').trim();
      if (text.length > 10) items.push(text);
    });
    if (items.length >= 2) lists.push(items);
  });

  assert(lists.length === 1, '1 list found');
  assert(lists[0].length === 3, '3 list items');

  // Statistics extraction
  const statPattern = /\b\d[\d,.]*\s*(%|percent|billion|million|thousand|trillion|USD|EUR|GBP)\b/gi;
  const statsFound: string[] = [];
  doc.querySelectorAll('p').forEach((p) => {
    const text = (p.textContent || '').trim();
    if (statPattern.test(text)) statsFound.push(text);
    statPattern.lastIndex = 0;
  });

  assert(statsFound.length >= 1, `Found ${statsFound.length} statistical sentences`);
  assert(statsFound.some((s) => s.includes('$150 billion')), 'Found $150 billion stat');
}

// ── Crawler link filtering ─────────────────────────────────────
function testCrawlerLinkFiltering() {
  console.log('\n=== CRAWLER LINK FILTER ===\n');

  const SKIP_EXTENSIONS = /\.(pdf|zip|tar|gz|mp4|mp3|png|jpg|jpeg|gif|svg|ico|woff)$/i;
  const SKIP_DOMAINS = /\b(facebook|twitter|instagram|tiktok|youtube|linkedin|reddit|t\.co|bit\.ly)\b/i;

  function isFollowableLink(href: string, sourceDomain: string): boolean {
    try {
      const url = new URL(href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      if (SKIP_EXTENSIONS.test(url.pathname)) return false;
      if (SKIP_DOMAINS.test(url.hostname)) return false;
      if (url.hostname === sourceDomain) return false;
      if (url.pathname === '/' || url.pathname === '') return false;
      return true;
    } catch { return false; }
  }

  assert(isFollowableLink('https://research.com/paper', 'example.com'), 'External article OK');
  assert(!isFollowableLink('https://example.com/page', 'example.com'), 'Same domain blocked');
  assert(!isFollowableLink('https://twitter.com/post', 'example.com'), 'Twitter blocked');
  assert(!isFollowableLink('https://facebook.com/post', 'example.com'), 'Facebook blocked');
  assert(!isFollowableLink('https://example.com/file.pdf', 'other.com'), 'PDF blocked');
  assert(!isFollowableLink('https://example.com/image.jpg', 'other.com'), 'Image blocked');
  assert(!isFollowableLink('ftp://example.com/file', 'other.com'), 'FTP blocked');
  assert(!isFollowableLink('https://research.com/', 'example.com'), 'Root path blocked');
  assert(isFollowableLink('https://docs.research.com/guide/intro', 'example.com'), 'Deep path OK');
}

// ── Run all parser tests ───────────────────────────────────────

async function main() {
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║  OFFLINE PARSER TESTS: No Network Required     ║');
  console.log('╚═══════════════════════════════════════════════╝');

  testWikipediaParsing();
  testGitHubUrlParsing();
  testArxivIdExtraction();
  testArxivXmlParsing();
  testRedditUrlParsing();
  testRedditCommentParsing();
  testSOHtmlStripping();
  testSOUrlParsing();
  testYouTubeIdExtraction();
  testYouTubeMetaParsing();
  testYouTubeChapters();
  testNewsDomainDetection();
  testNewsContentCleaning();
  testJsonLdParsing();
  testPdfUrlDetection();
  testStructuredDataExtraction();
  testCrawlerLinkFiltering();

  console.log('\n' + '═'.repeat(49));
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  else console.log('ALL PARSER TESTS PASSED ✓');
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
