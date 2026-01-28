/**
 * Bookmark Processor - Fetches and prepares Twitter bookmarks for analysis
 *
 * This handles the mechanical work:
 * - Fetching bookmarks via bird CLI
 * - Expanding t.co links
 * - Extracting content from linked pages (articles, GitHub repos)
 * - Optional: Bypassing paywalls via archive.ph
 *
 * Outputs a JSON bundle for AI analysis (Claude Code, etc.)
 */

import { execSync, execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { loadConfig } from './config.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// Sites that typically require paywall bypass
const PAYWALL_DOMAINS = [
  'nytimes.com',
  'wsj.com',
  'washingtonpost.com',
  'theatlantic.com',
  'newyorker.com',
  'bloomberg.com',
  'ft.com',
  'economist.com',
  'bostonglobe.com',
  'latimes.com',
  'wired.com'
];

export function loadState(config) {
  try {
    const content = fs.readFileSync(config.stateFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {
      last_processed_id: null,
      last_check: null,
      last_processing_run: null
    };
  }
}

export function saveState(config, state) {
  const dir = path.dirname(config.stateFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2) + '\n');
}

function buildBirdEnv(config) {
  const env = { ...process.env };
  if (config.twitter?.authToken) {
    env.AUTH_TOKEN = config.twitter.authToken;
  }
  if (config.twitter?.ct0) {
    env.CT0 = config.twitter.ct0;
  }
  return env;
}

export function fetchBookmarks(config, count = 10, options = {}) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';

    // Use --all for large fetches (> 50) or when explicitly requested
    const useAll = options.all || count > 50;
    const folderId = options.folderId;

    let cmd;
    if (useAll) {
      // Paginated fetch - use longer timeout
      const maxPages = options.maxPages || 10; // Limit pages to prevent runaway
      cmd = folderId
        ? `${birdCmd} bookmarks --folder-id ${folderId} --all --max-pages ${maxPages} --json`
        : `${birdCmd} bookmarks --all --max-pages ${maxPages} --json`;
    } else {
      cmd = folderId
        ? `${birdCmd} bookmarks --folder-id ${folderId} -n ${count} --json`
        : `${birdCmd} bookmarks -n ${count} --json`;
    }

    console.log(`  Running: ${cmd.replace(/--json/, '').trim()}`);

    // Use temp file to work around bird CLI pipe buffering bug
    const tmpFile = path.join(os.tmpdir(), `smaug-bookmarks-${Date.now()}.json`);
    execSync(`${cmd} > "${tmpFile}"`, {
      timeout: useAll ? 180000 : 60000, // 3 min for --all, 60s otherwise
      env,
      shell: true
    });
    const output = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    const parsed = JSON.parse(output);
    // bird CLI v0.6.0+ returns { tweets: [...], nextCursor: ... } for paginated requests
    // but plain arrays for non-paginated. Handle both formats.
    return Array.isArray(parsed) ? parsed : (parsed.tweets || []);
  } catch (error) {
    throw new Error(`Failed to fetch bookmarks: ${error.message}`);
  }
}

export function fetchLikes(config, count = 10) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    // Use temp file to work around bird CLI pipe buffering bug
    const tmpFile = path.join(os.tmpdir(), `smaug-likes-${Date.now()}.json`);
    execSync(`${birdCmd} likes -n ${count} --json > "${tmpFile}"`, {
      timeout: 60000,
      env,
      shell: true
    });
    const output = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);
    const parsed = JSON.parse(output);
    // Handle both array and object formats for consistency
    return Array.isArray(parsed) ? parsed : (parsed.tweets || []);
  } catch (error) {
    throw new Error(`Failed to fetch likes: ${error.message}`);
  }
}

export function fetchFromSource(config, count = 10, options = {}) {
  const source = config.source || 'bookmarks';

  if (source === 'bookmarks') {
    return fetchBookmarks(config, count, options);
  } else if (source === 'likes') {
    return fetchLikes(config, count);
  } else if (source === 'both') {
    const bookmarks = fetchBookmarks(config, count, options);
    const likes = fetchLikes(config, count);
    // Merge and dedupe by ID
    const seen = new Set();
    const merged = [];
    for (const item of [...bookmarks, ...likes]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  } else {
    throw new Error(`Invalid source: ${source}. Must be 'bookmarks', 'likes', or 'both'.`);
  }
}

/**
 * Fetch bookmarks from configured folders, tagging each with its folder name
 */
export function fetchFromFolders(config, count = 10, options = {}) {
  const folders = config.folders || {};
  const folderIds = Object.keys(folders);

  if (folderIds.length === 0) {
    return [];
  }

  console.log(`Fetching from ${folderIds.length} configured folder(s)...`);

  const allBookmarks = [];
  const seen = new Set();

  for (const folderId of folderIds) {
    const folderTag = folders[folderId];
    console.log(`\n📁 Folder "${folderTag}" (${folderId}):`);

    try {
      const bookmarks = fetchBookmarks(config, count, { ...options, folderId });
      let added = 0;

      for (const bookmark of bookmarks) {
        if (!seen.has(bookmark.id)) {
          seen.add(bookmark.id);
          // Add folder tag to the bookmark
          bookmark._folderTag = folderTag;
          bookmark._folderId = folderId;
          allBookmarks.push(bookmark);
          added++;
        }
      }

      console.log(`  Found ${bookmarks.length} bookmarks, ${added} new`);
    } catch (error) {
      console.error(`  Error fetching folder ${folderId}: ${error.message}`);
    }
  }

  return allBookmarks;
}

export function fetchTweet(config, tweetId) {
  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    const output = execSync(`${birdCmd} read ${tweetId} --json`, {
      encoding: 'utf8',
      timeout: 15000,
      env
    });
    return JSON.parse(output);
  } catch (error) {
    console.log(`  Could not fetch parent tweet ${tweetId}: ${error.message}`);
    return null;
  }
}

export async function expandTcoLink(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    return response.url || url;
  } catch (error) {
    console.error(`Failed to expand ${url}: ${error.message}`);
    return url;
  }
}

export function isPaywalled(url) {
  return PAYWALL_DOMAINS.some(domain => url.includes(domain));
}

export function stripQuerystring(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Extract X article ID from an x.com/i/article/ URL
 * @param {string} url - The URL to extract from
 * @returns {string|null} - The article ID or null if not an article URL
 */
export function extractXArticleId(url) {
  const match = url.match(/x\.com\/i\/article\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Detect the type of a link based on its URL
 * @param {string} url - The expanded URL
 * @returns {string} - One of: 'github', 'video', 'x-article', 'media', 'tweet', 'image', 'article'
 */
export function detectLinkType(url) {
  if (url.includes('github.com')) {
    return 'github';
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'video';
  }
  if (url.includes('x.com') || url.includes('twitter.com')) {
    // Check for X articles first (x.com/i/article/)
    if (url.includes('/i/article/')) {
      return 'x-article';
    }
    if (url.includes('/photo/') || url.includes('/video/')) {
      return 'media';
    }
    return 'tweet';
  }
  if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    return 'image';
  }
  return 'article';
}

/**
 * Fetch X article content using bird CLI
 * @param {string} articleId - The X article ID
 * @param {object} config - Config object with bird CLI settings
 * @returns {object|null} - Content object with title and text, or null on failure
 */
export function fetchXArticleContent(articleId, config) {
  // Validate articleId is numeric to prevent command injection
  if (!/^\d+$/.test(String(articleId))) {
    console.log(`  Invalid article ID format: ${articleId}`);
    return null;
  }

  try {
    const env = buildBirdEnv(config);
    const birdCmd = config.birdPath || 'bird';
    const output = execSync(`${birdCmd} read ${articleId} --json`, {
      encoding: 'utf8',
      timeout: 30000,
      env
    });
    const data = JSON.parse(output);
    return {
      title: data.article?.title || null,
      text: data.text || '',
      source: 'bird-cli'
    };
  } catch (error) {
    console.log(`  Could not fetch X article ${articleId}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch article content using summarize CLI for clean extraction
 * @param {string} url - The article URL
 * @returns {object|null} - Content object with title, description, text, or null on failure
 */
export function fetchArticleWithSummarize(url) {
  try {
    // Validate URL format to prevent command injection
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      console.log(`  Invalid URL protocol: ${parsedUrl.protocol}`);
      return null;
    }

    // Use execFileSync to avoid shell interpolation (prevents command injection)
    const output = execFileSync(
      'summarize',
      ['--extract', '--format', 'md', '--json', url],
      {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024 // 10MB for large articles
      }
    );
    const data = JSON.parse(output);
    if (data.extracted) {
      return {
        title: data.extracted.title || null,
        description: data.extracted.description || null,
        text: data.extracted.content || '',
        source: 'summarize-cli'
      };
    }
    return null;
  } catch (error) {
    console.log(`  Summarize CLI failed for ${url}: ${error.message}`);
    return null;
  }
}

function extractGitHubInfo(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

export async function fetchGitHubContent(url) {
  const info = extractGitHubInfo(url);
  if (!info) {
    throw new Error('Could not parse GitHub URL');
  }

  const { owner, repo } = info;

  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const repoResponse = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    const repoJson = await repoResponse.json();

    // Fetch README content
    let readme = '';
    try {
      const readmeUrl = `https://api.github.com/repos/${owner}/${repo}/readme`;
      const readmeResponse = await fetch(readmeUrl, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      const readmeJson = await readmeResponse.json();
      if (readmeJson.content) {
        readme = Buffer.from(readmeJson.content, 'base64').toString('utf8');
        if (readme.length > 5000) {
          readme = readme.slice(0, 5000) + '\n...[truncated]';
        }
      }
    } catch (e) {
      console.log(`  No README found for ${owner}/${repo}`);
    }

    return {
      name: repoJson.name,
      fullName: repoJson.full_name,
      description: repoJson.description || '',
      stars: repoJson.stargazers_count,
      language: repoJson.language,
      topics: repoJson.topics || [],
      readme,
      url: repoJson.html_url
    };
  } catch (error) {
    console.error(`  GitHub API error for ${owner}/${repo}: ${error.message}`);
    throw error;
  }
}

export async function fetchArticleContent(url) {
  // Try summarize CLI first for clean extraction
  const summarized = fetchArticleWithSummarize(url);
  if (summarized && summarized.text) {
    console.log(`  Extracted with summarize: "${summarized.title || 'untitled'}"`);
    return summarized;
  }

  // Fallback to direct fetch if summarize fails
  console.log(`  Falling back to direct fetch for ${url}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    const text = await response.text();
    // Limit to 50KB like the old curl | head -c 50000
    const result = text.slice(0, 50000);

    // Check for paywall indicators
    if (result.includes('Subscribe') && result.includes('sign in') ||
        result.includes('This article is for subscribers') ||
        result.length < 1000) {
      return { text: result, source: 'direct', paywalled: true };
    }

    return { text: result, source: 'direct', paywalled: false };
  } catch (error) {
    throw error;
  }
}

export async function fetchContent(url, type, config) {
  // Use GitHub API for GitHub URLs
  if (type === 'github') {
    try {
      const ghContent = await fetchGitHubContent(url);
      return { ...ghContent, source: 'github-api' };
    } catch (error) {
      console.log(`  GitHub API failed: ${error.message}`);
    }
  }

  // For paywalled sites, note for manual handling or custom bypass
  if (isPaywalled(url)) {
    console.log(`  Paywalled domain detected: ${url}`);
    return {
      url,
      source: 'paywalled',
      note: 'Content requires paywall bypass - see README for options'
    };
  }

  // Try direct fetch for other URLs
  return await fetchArticleContent(url);
}

export function getExistingBookmarkIds(config) {
  try {
    const content = fs.readFileSync(config.archiveFile, 'utf8');
    const matches = content.matchAll(/x\.com\/\w+\/status\/(\d+)/g);
    return new Set([...matches].map(m => m[1]));
  } catch {
    return new Set();
  }
}

export async function fetchAndPrepareBookmarks(options = {}) {
  const config = loadConfig(options.configPath);
  const now = dayjs().tz(config.timezone || 'America/New_York');
  console.log(`[${now.format()}] Fetching and preparing bookmarks...`);

  const state = loadState(config);
  const source = options.source || config.source || 'bookmarks';
  const includeMedia = options.includeMedia ?? config.includeMedia ?? false;
  const configWithOptions = { ...config, source, includeMedia };
  const count = options.count || 20;

  // Build fetch options for pagination
  const fetchOptions = {
    all: options.all || count > 50,
    maxPages: options.maxPages
  };

  let tweets = [];
  const hasFolders = Object.keys(config.folders || {}).length > 0;

  if (hasFolders && source === 'bookmarks') {
    // Fetch from each configured folder with tags
    console.log(`Fetching from ${Object.keys(config.folders).length} folder(s)${includeMedia ? ' (with media)' : ''}`);
    tweets = fetchFromFolders(configWithOptions, count, fetchOptions);
  } else {
    // Normal fetch from source
    console.log(`Fetching from source: ${source}${includeMedia ? ' (with media)' : ''}${fetchOptions.all ? ' (paginated)' : ''}`);
    tweets = fetchFromSource(configWithOptions, count, fetchOptions);
  }

  if (!tweets || tweets.length === 0) {
    console.log(`No ${source} found`);
    return { bookmarks: [], count: 0 };
  }

  // Get IDs already processed or pending
  const existingIds = getExistingBookmarkIds(config);
  let pendingIds = new Set();
  try {
    if (fs.existsSync(config.pendingFile)) {
      const pending = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));
      pendingIds = new Set((pending.bookmarks || []).map(b => b.id.toString()));
    }
  } catch (e) {}

  // Determine which tweets to process
  let toProcess;
  if (options.specificIds) {
    toProcess = tweets.filter(b => options.specificIds.includes(b.id.toString()));
  } else if (options.force) {
    // Force mode: skip duplicate checking, process all fetched tweets
    toProcess = tweets;
  } else {
    toProcess = tweets.filter(b => {
      const id = b.id.toString();
      return !existingIds.has(id) && !pendingIds.has(id);
    });
  }

  if (toProcess.length === 0) {
    console.log('No new tweets to process');
    return { bookmarks: [], count: 0 };
  }

  console.log(`Preparing ${toProcess.length} tweets...`);

  const prepared = [];

  for (const bookmark of toProcess) {
    try {
      console.log(`\nProcessing bookmark ${bookmark.id}...`);
      const text = bookmark.text || bookmark.full_text || '';

      // Format date from tweet's createdAt, falling back to current date
      let date;
      if (bookmark.createdAt) {
        const tweetDate = dayjs(bookmark.createdAt).tz(config.timezone || 'America/New_York');
        date = tweetDate.format('dddd, MMMM D, YYYY');
      } else {
        date = now.format('dddd, MMMM D, YYYY');
      }
      const author = bookmark.author?.username || bookmark.user?.screen_name || 'unknown';

      // Find and expand t.co links
      const tcoLinks = text.match(/https?:\/\/t\.co\/\w+/g) || [];
      const links = [];

      for (const link of tcoLinks) {
        const expanded = await expandTcoLink(link);
        console.log(`  Expanded: ${link} -> ${expanded}`);

        // Categorize the link using the new detectLinkType function
        const type = detectLinkType(expanded);
        let content = null;

        // Handle content fetching based on type
        if (type === 'x-article') {
          // X article - fetch using bird CLI with the BOOKMARK's tweet ID
          // (not the article ID from the URL - they're different)
          console.log(`  X article detected, fetching with tweet ID ${bookmark.id}...`);
          const articleContent = fetchXArticleContent(bookmark.id, config);
          if (articleContent) {
            content = articleContent;
            console.log(`  X article: "${articleContent.title || 'untitled'}"`);
          }
        } else if (type === 'tweet') {
          // Quote tweet - fetch the quoted tweet for context
          const tweetIdMatch = expanded.match(/status\/(\d+)/);
          if (tweetIdMatch) {
            const quotedTweetId = tweetIdMatch[1];
            console.log(`  Quote tweet detected, fetching ${quotedTweetId}...`);
            const quotedTweet = fetchTweet(config, quotedTweetId);
            if (quotedTweet) {
              content = {
                id: quotedTweet.id,
                author: quotedTweet.author?.username || 'unknown',
                authorName: quotedTweet.author?.name || quotedTweet.author?.username || 'unknown',
                text: quotedTweet.text || quotedTweet.full_text || '',
                tweetUrl: `https://x.com/${quotedTweet.author?.username || 'unknown'}/status/${quotedTweet.id}`,
                source: 'quote-tweet'
              };
            }
          }
        } else if (type === 'article' || type === 'github') {
          // Fetch content for articles and GitHub repos
          try {
            const fetchResult = await fetchContent(expanded, type, config);

            if (fetchResult.source === 'github-api') {
              content = {
                name: fetchResult.name,
                fullName: fetchResult.fullName,
                description: fetchResult.description,
                stars: fetchResult.stars,
                language: fetchResult.language,
                topics: fetchResult.topics,
                readme: fetchResult.readme,
                url: fetchResult.url,
                source: 'github-api'
              };
              console.log(`  GitHub repo: ${fetchResult.fullName} (${fetchResult.stars} stars)`);
            } else if (fetchResult.source === 'summarize-cli') {
              // Clean extracted content from summarize CLI
              content = {
                title: fetchResult.title,
                description: fetchResult.description,
                text: fetchResult.text?.slice(0, 50000),
                source: 'summarize-cli'
              };
            } else {
              // Fallback direct fetch
              content = {
                text: fetchResult.text?.slice(0, 10000),
                source: fetchResult.source,
                paywalled: fetchResult.paywalled
              };
            }
          } catch (error) {
            console.log(`  Could not fetch content: ${error.message}`);
            content = { error: error.message };
          }
        }

        links.push({
          original: link,
          expanded,
          type,
          content
        });
      }

      // If this is a reply, fetch the parent tweet for context
      let replyContext = null;
      if (bookmark.inReplyToStatusId) {
        console.log(`  This is a reply to ${bookmark.inReplyToStatusId}, fetching parent...`);
        const parentTweet = fetchTweet(config, bookmark.inReplyToStatusId);
        if (parentTweet) {
          replyContext = {
            id: parentTweet.id,
            author: parentTweet.author?.username || 'unknown',
            authorName: parentTweet.author?.name || parentTweet.author?.username || 'unknown',
            text: parentTweet.text || parentTweet.full_text || '',
            tweetUrl: `https://x.com/${parentTweet.author?.username || 'unknown'}/status/${parentTweet.id}`
          };
        }
      }

      // Check for native quote tweet
      let quoteContext = null;
      if (bookmark.quotedTweet) {
        const qt = bookmark.quotedTweet;
        quoteContext = {
          id: qt.id,
          author: qt.author?.username || 'unknown',
          authorName: qt.author?.name || qt.author?.username || 'unknown',
          text: qt.text || '',
          tweetUrl: `https://x.com/${qt.author?.username || 'unknown'}/status/${qt.id}`,
          source: 'native-quote'
        };
      }

      // Capture media attachments (photos, videos, GIFs) - EXPERIMENTAL
      // Only included if includeMedia is true (--media flag)
      const media = configWithOptions.includeMedia ? (bookmark.media || []) : [];

      // Build tags array from folder tag (if present)
      const tags = [];
      if (bookmark._folderTag) {
        tags.push(bookmark._folderTag);
      }

      prepared.push({
        id: bookmark.id,
        author,
        authorName: bookmark.author?.name || bookmark.user?.name || author,
        text,
        tweetUrl: `https://x.com/${author}/status/${bookmark.id}`,
        createdAt: bookmark.createdAt,
        links,
        media,
        tags,
        date,
        isReply: !!bookmark.inReplyToStatusId,
        replyContext,
        isQuote: !!quoteContext,
        quoteContext
      });

      const mediaInfo = media.length > 0 ? ` (${media.length} media)` : '';
      const tagInfo = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      console.log(`  Prepared: @${author} with ${links.length} links${mediaInfo}${tagInfo}${replyContext ? ' (reply)' : ''}${quoteContext ? ' (quote)' : ''}`);

    } catch (error) {
      console.error(`  Error processing bookmark ${bookmark.id}: ${error.message}`);
    }
  }

  // Merge prepared bookmarks into pending file
  let existingPending = { bookmarks: [] };
  try {
    if (fs.existsSync(config.pendingFile)) {
      const parsed = JSON.parse(fs.readFileSync(config.pendingFile, 'utf8'));
      existingPending = { bookmarks: parsed.bookmarks || [], ...parsed };
    }
  } catch (e) {}

  const existingPendingIds = new Set(existingPending.bookmarks.map(b => b.id));
  const newBookmarks = prepared.filter(b => !existingPendingIds.has(b.id));

  // Merge and sort by createdAt ascending (oldest first)
  // This ensures when processed, oldest get added first, newest end up on top
  const allBookmarks = [...existingPending.bookmarks, ...newBookmarks];
  allBookmarks.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateA - dateB; // Ascending: oldest first
  });

  const output = {
    generatedAt: now.toISOString(),
    count: allBookmarks.length,
    bookmarks: allBookmarks
  };

  const pendingDir = path.dirname(config.pendingFile);
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true });
  }
  fs.writeFileSync(config.pendingFile, JSON.stringify(output, null, 2));
  console.log(`\nMerged ${newBookmarks.length} new bookmarks into ${config.pendingFile} (total: ${output.count})`);

  // Update state
  state.last_check = now.toISOString();
  saveState(config, state);

  return { bookmarks: prepared, count: prepared.length, pendingFile: config.pendingFile };
}
