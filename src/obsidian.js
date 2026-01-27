/**
 * Obsidian Note Formatter
 *
 * Converts Twitter bookmarks into Obsidian vault notes
 * using the Clipping Template format.
 */

import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Max filename length (excluding extension) - conservative for cross-platform compatibility
 * Windows has 260 char path limit, macOS/Linux 255 char filename limit
 */
const MAX_FILENAME_LENGTH = 80;

/**
 * Sanitize a string for use as a filename
 * Removes characters that are invalid in filenames across platforms
 * @param {string} name - The string to sanitize
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(name) {
  if (!name) return 'untitled';

  const sanitized = name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/'/g, '-')
    .replace(/\.{2,}/g, '.') // Collapse multiple dots (prevent path traversal)
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '') // Remove leading/trailing dots, dashes, whitespace
    .replace(/-+/g, '-') // Collapse multiple dashes
    .trim();

  return sanitized || 'untitled';
}

/**
 * Generate a filename for the note
 * Uses article title if available, otherwise @author - first sentence
 * @param {object} bookmark - The bookmark object
 * @returns {string} Generated filename with .md extension
 */
export function generateNoteFilename(bookmark) {
  const link = bookmark.links?.[0];
  const hasLinkContent = link?.content?.title;

  if (hasLinkContent) {
    const title = sanitizeFilename(link.content.title);
    return `${title}.md`;
  }

  // Use @author - first sentence (same as title)
  const author = `@${bookmark.author || 'unknown'}`;
  const firstSentence = extractFirstSentence(bookmark.text);
  const baseFilename = firstSentence
    ? sanitizeFilename(`${author} - ${firstSentence}`)
    : sanitizeFilename(author);

  const truncated = baseFilename.length > MAX_FILENAME_LENGTH
    ? baseFilename.slice(0, MAX_FILENAME_LENGTH).trim()
    : baseFilename;

  return `${truncated}.md`;
}

/**
 * Extract author for the note
 * - For tweets with links: use link.content.author if available
 * - Falls back to @tweetAuthor
 * @param {object} bookmark - The bookmark object
 * @returns {string} Author name
 */
function extractAuthor(bookmark) {
  const link = bookmark.links?.[0];

  if (link?.content?.author) {
    return link.content.author;
  }

  // Fall back to tweet author with @ prefix
  return `@${bookmark.author || 'unknown'}`;
}

/**
 * Extract body content for the note
 * - For tweets with links: use link.content.text
 * - Falls back to bookmark.text
 * @param {object} bookmark - The bookmark object
 * @returns {string} Body content
 */
function extractBody(bookmark) {
  const link = bookmark.links?.[0];

  if (link?.content?.text) {
    return link.content.text;
  }

  return bookmark.text || '';
}

/**
 * Extract source URL
 * - For tweets with links: use expanded link URL
 * - Falls back to tweet URL
 * @param {object} bookmark - The bookmark object
 * @returns {string} Source URL
 */
function extractSource(bookmark) {
  const link = bookmark.links?.[0];

  if (link?.expanded) {
    return link.expanded;
  }

  return bookmark.tweetUrl || '';
}

/**
 * Extract first sentence from text
 * @param {string} text - The text to extract from
 * @returns {string} First sentence (up to ~80 chars)
 */
function extractFirstSentence(text) {
  if (!text) return '';

  // Clean up text: remove newlines, collapse spaces
  const cleaned = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Find first sentence ending (. ! ?)
  const sentenceEnd = cleaned.search(/[.!?]\s|[.!?]$/);

  if (sentenceEnd > 0 && sentenceEnd < 80) {
    return cleaned.slice(0, sentenceEnd + 1).trim();
  }

  // No sentence ending found, truncate at ~80 chars at word boundary
  if (cleaned.length <= 80) return cleaned;

  const truncated = cleaned.slice(0, 80);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 40 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

/**
 * Extract title for the note
 * - For tweets with links: use link.content.title
 * - For plain tweets: @author - first sentence
 * @param {object} bookmark - The bookmark object
 * @returns {string} Title
 */
function extractTitle(bookmark) {
  const link = bookmark.links?.[0];

  if (link?.content?.title) {
    return link.content.title;
  }

  const author = `@${bookmark.author || 'unknown'}`;
  const firstSentence = extractFirstSentence(bookmark.text);

  return firstSentence ? `${author} - ${firstSentence}` : author;
}

/**
 * Extract description
 * - For tweets with links: use link.content.description or first ~100 chars of text
 * - Falls back to first ~100 chars of tweet text
 * @param {object} bookmark - The bookmark object
 * @returns {string} Description
 */
function extractDescription(bookmark) {
  const link = bookmark.links?.[0];

  if (link?.content?.description) {
    return link.content.description;
  }

  const text = extractBody(bookmark);
  return text.slice(0, 100).replace(/\n/g, ' ').trim();
}

/**
 * Format a bookmark into an Obsidian Clipping note
 * @param {object} bookmark - The bookmark object
 * @returns {string} Formatted note content
 */
export function formatClippingNote(bookmark) {
  const author = extractAuthor(bookmark);
  const body = extractBody(bookmark);
  const source = extractSource(bookmark);
  const title = extractTitle(bookmark);
  const description = extractDescription(bookmark);

  // Format author for frontmatter - wrap in [[]] for Obsidian linking
  const authorLink = author.startsWith('@')
    ? `[[@${author.slice(1)}]]`
    : `[[${author}]]`;

  // Format timestamps (ISO 8601 with timezone offset, e.g., 2026-01-25T20:31:23-08:00)
  // published = when the original tweet/article was created
  // created = when we clipped it (now)
  const formatTimestamp = (date) => dayjs(date).format('YYYY-MM-DDTHH:mm:ssZ');
  const published = bookmark.createdAt ? formatTimestamp(bookmark.createdAt) : '';
  const created = formatTimestamp(new Date());

  // Escape description for YAML (quotes and newlines)
  const escapedDescription = description
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');

  // Build frontmatter (matching Clipping Template.md format)
  const frontmatter = `---
categories:
  - "[[Clippings]]"
tags:
  - clippings
author:
  - "${authorLink}"
url: "${source}"
created: ${created}
published: ${published}
topics: []
---`;

  // Build note content
  const note = `${frontmatter}
# ${title}

${body}
`;

  return note;
}

/**
 * Extract source URL from a bookmark (same logic as formatClippingNote)
 * @param {object} bookmark - The bookmark object
 * @returns {string} Source URL
 */
function getSourceUrl(bookmark) {
  const link = bookmark.links?.[0];
  return link?.expanded || bookmark.tweetUrl || '';
}

/**
 * Check if a note with the given source URL already exists in the clippings folder
 * @param {string} clippingsDir - Path to the clippings directory
 * @param {string} sourceUrl - The source URL to check for
 * @returns {string|null} Path to existing note if found, null otherwise
 */
export function findExistingNoteBySource(clippingsDir, sourceUrl) {
  if (!sourceUrl || !fs.existsSync(clippingsDir)) {
    return null;
  }

  try {
    const files = fs.readdirSync(clippingsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(clippingsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Check if this file has the same URL in frontmatter (check both 'url' and 'source' for compatibility)
      const urlMatch = content.match(/^url:\s*"([^"]+)"/m) || content.match(/^source:\s*"([^"]+)"/m);
      if (urlMatch && urlMatch[1] === sourceUrl) {
        return filePath;
      }
    }
  } catch {
    // If we can't read the directory, assume no duplicates
  }

  return null;
}

/**
 * Write a clipping note to the Obsidian vault
 * @param {string} vaultPath - Path to the Obsidian vault
 * @param {object} bookmark - The bookmark object
 * @param {object} options - Options (clippingsFolder, skipDuplicates)
 * @returns {object} Result with filePath, filename, content, and skipped flag
 * @throws {Error} If path validation fails or write fails
 */
export function writeClippingNote(vaultPath, bookmark, options = {}) {
  const { clippingsFolder = 'Clippings', skipDuplicates = true } = options;

  if (!vaultPath) {
    throw new Error('Vault path is required');
  }

  const content = formatClippingNote(bookmark);
  const filename = generateNoteFilename(bookmark);
  const clippingsDir = path.resolve(vaultPath, clippingsFolder);

  try {
    // Ensure Clippings directory exists
    if (!fs.existsSync(clippingsDir)) {
      fs.mkdirSync(clippingsDir, { recursive: true });
    }

    // Check for duplicates by source URL
    if (skipDuplicates) {
      const sourceUrl = getSourceUrl(bookmark);
      const existingNote = findExistingNoteBySource(clippingsDir, sourceUrl);
      if (existingNote) {
        return {
          filePath: existingNote,
          filename: path.basename(existingNote),
          content: null,
          skipped: true,
          reason: 'duplicate'
        };
      }
    }

    const filePath = path.resolve(clippingsDir, filename);

    // CRITICAL: Validate the resolved path is within clippingsDir (prevent path traversal)
    if (!filePath.startsWith(clippingsDir + path.sep) && filePath !== clippingsDir) {
      throw new Error(`Invalid filename would escape vault directory: ${filename}`);
    }

    fs.writeFileSync(filePath, content, 'utf8');

    return {
      filePath,
      filename,
      content,
      skipped: false
    };
  } catch (error) {
    if (error.message.includes('escape vault directory')) {
      throw error;
    }
    throw new Error(`Failed to write note "${filename}": ${error.message}`);
  }
}
