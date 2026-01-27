import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  formatClippingNote,
  generateNoteFilename,
  writeClippingNote,
  sanitizeFilename,
  findExistingNoteBySource
} from '../src/obsidian.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test fixtures - prepared bookmark format from processor.js
const bookmarkWithoutLink = {
  id: '1234567890',
  author: 'dhh',
  authorName: 'David Heinemeier Hansson',
  text: 'Just shipped Rails 8 with the new async rendering pipeline. Performance gains are massive.',
  tweetUrl: 'https://x.com/dhh/status/1234567890',
  createdAt: '2026-01-26T10:30:00Z',
  links: [],
  media: [],
  tags: [],
  date: 'Sunday, January 26, 2026',
  isReply: false,
  isQuote: false
};

const bookmarkWithLink = {
  id: '9876543210',
  author: 'zachbruggeman',
  authorName: 'Zach Bruggeman',
  text: 'Great read on building coding agents at scale',
  tweetUrl: 'https://x.com/zachbruggeman/status/9876543210',
  createdAt: '2026-01-25T20:31:23Z',
  links: [
    {
      original: 'https://t.co/abc123',
      expanded: 'https://builders.ramp.com/post/why-we-built-our-background-agent',
      type: 'article',
      content: {
        title: 'Why We Built Our Own Background Agent',
        author: 'Zach Bruggeman',
        text: 'The craft of engineering is rapidly changing. We built our own coding agent to accelerate faster.',
        description: 'Building a background coding agent at Ramp'
      }
    }
  ],
  media: [],
  tags: ['ai-tools'],
  date: 'Saturday, January 25, 2026',
  isReply: false,
  isQuote: false
};

const bookmarkWithLinkNoAuthor = {
  id: '5555555555',
  author: 'someuser',
  authorName: 'Some User',
  text: 'Check out this interesting repo',
  tweetUrl: 'https://x.com/someuser/status/5555555555',
  createdAt: '2026-01-24T15:00:00Z',
  links: [
    {
      original: 'https://t.co/xyz789',
      expanded: 'https://github.com/user/cool-project',
      type: 'github',
      content: {
        title: 'cool-project',
        text: 'A cool project description from GitHub',
        description: 'Cool project'
      }
    }
  ],
  media: [],
  tags: [],
  date: 'Friday, January 24, 2026',
  isReply: false,
  isQuote: false
};

describe('sanitizeFilename', () => {
  test('removes forward slashes', () => {
    assert.strictEqual(sanitizeFilename('test/file'), 'test-file');
  });

  test('removes colons', () => {
    assert.strictEqual(sanitizeFilename('test:file'), 'test-file');
  });

  test('removes pipes', () => {
    assert.strictEqual(sanitizeFilename('test|file'), 'test-file');
  });

  test('removes backslashes', () => {
    assert.strictEqual(sanitizeFilename('test\\file'), 'test-file');
  });

  test('removes question marks and asterisks', () => {
    assert.strictEqual(sanitizeFilename('test?file*name'), 'test-file-name');
  });

  test('removes angle brackets', () => {
    assert.strictEqual(sanitizeFilename('test<file>name'), 'test-file-name');
  });

  test('removes quotes', () => {
    assert.strictEqual(sanitizeFilename('test"file\'name'), 'test-file-name');
  });

  test('trims whitespace', () => {
    assert.strictEqual(sanitizeFilename('  test file  '), 'test file');
  });

  test('handles empty string', () => {
    assert.strictEqual(sanitizeFilename(''), 'untitled');
  });

  test('handles string that becomes empty after sanitization', () => {
    assert.strictEqual(sanitizeFilename('///'), 'untitled');
  });

  test('removes leading and trailing dots', () => {
    assert.strictEqual(sanitizeFilename('.hidden'), 'hidden');
    assert.strictEqual(sanitizeFilename('file.'), 'file');
    assert.strictEqual(sanitizeFilename('...test...'), 'test');
  });

  test('collapses multiple dots (path traversal prevention)', () => {
    assert.strictEqual(sanitizeFilename('..'), 'untitled');
    assert.strictEqual(sanitizeFilename('test..file'), 'test.file');
    assert.strictEqual(sanitizeFilename('../../../etc/passwd'), 'etc-passwd');
  });
});

describe('generateNoteFilename', () => {
  test('generates filename from article title', () => {
    const filename = generateNoteFilename(bookmarkWithLink);
    assert.strictEqual(filename, 'Why We Built Our Own Background Agent.md');
  });

  test('generates filename from tweet author and first sentence when no link', () => {
    const filename = generateNoteFilename(bookmarkWithoutLink);
    assert.ok(filename.startsWith('@dhh'), 'Should start with author');
    assert.ok(filename.includes('Just shipped Rails 8'), 'Should include first sentence');
    assert.ok(filename.endsWith('.md'), 'Should end with .md');
    assert.ok(!filename.includes('1234567890'), 'Should not include tweet ID');
  });

  test('truncates long filenames', () => {
    const longTextBookmark = {
      ...bookmarkWithoutLink,
      text: 'This is a very long tweet that goes on and on and on and on and should definitely be truncated because it is way too long for a filename'
    };
    const filename = generateNoteFilename(longTextBookmark);
    assert.ok(filename.length <= 100, `Filename too long: ${filename.length}`);
  });

  test('sanitizes special characters in filename', () => {
    const bookmarkWithSpecialChars = {
      ...bookmarkWithLink,
      links: [{
        ...bookmarkWithLink.links[0],
        content: {
          ...bookmarkWithLink.links[0].content,
          title: 'What/Why: The Future?'
        }
      }]
    };
    const filename = generateNoteFilename(bookmarkWithSpecialChars);
    assert.ok(!filename.includes('/'), 'Filename should not contain /');
    assert.ok(!filename.includes(':'), 'Filename should not contain :');
    assert.ok(!filename.includes('?'), 'Filename should not contain ?');
  });

  test('does not append tweet ID to filename', () => {
    const filename = generateNoteFilename(bookmarkWithoutLink);
    assert.ok(!filename.includes('1234567890'), 'Filename should not contain tweet ID');
  });

  test('sanitizes path traversal attempts in title', () => {
    const maliciousBookmark = {
      ...bookmarkWithLink,
      links: [{
        ...bookmarkWithLink.links[0],
        content: {
          ...bookmarkWithLink.links[0].content,
          title: '../../../etc/passwd'
        }
      }]
    };
    const filename = generateNoteFilename(maliciousBookmark);
    assert.ok(!filename.includes('..'), 'Filename should not contain ..');
    assert.ok(!filename.startsWith('.'), 'Filename should not start with .');
  });
});

describe('formatClippingNote', () => {
  test('formats bookmark without link using tweet author and text', () => {
    const note = formatClippingNote(bookmarkWithoutLink);

    // Check frontmatter
    assert.ok(note.includes('---'), 'Should have frontmatter delimiter');
    assert.ok(note.includes('url: "https://x.com/dhh/status/1234567890"'), 'Should have tweet URL');
    assert.ok(note.includes('[[@dhh]]'), 'Should have @author format');
    assert.ok(note.includes('tags:'), 'Should have tags section');
    assert.ok(note.includes('- clippings'), 'Should have clippings tag');
    assert.ok(note.includes('categories:'), 'Should have categories section');
    assert.ok(note.includes('- "[[Clippings]]"'), 'Should have Clippings category');
    assert.ok(note.includes('topics: []'), 'Should have topics field');

    // Check body
    assert.ok(note.includes('Just shipped Rails 8'), 'Should contain tweet text');
  });

  test('formats bookmark with link using link author and content', () => {
    const note = formatClippingNote(bookmarkWithLink);

    // Check frontmatter - should use article URL
    assert.ok(note.includes('url: "https://builders.ramp.com/post/why-we-built-our-background-agent"'), 'Should have article URL');
    assert.ok(note.includes('[[Zach Bruggeman]]'), 'Should have article author');

    // Check body - should use article content
    assert.ok(note.includes('The craft of engineering is rapidly changing'), 'Should contain article text');
  });

  test('falls back to tweet author when link has no author', () => {
    const note = formatClippingNote(bookmarkWithLinkNoAuthor);

    // Should fall back to tweet author with @ prefix
    assert.ok(note.includes('[[@someuser]]'), 'Should fall back to @tweetAuthor');
  });

  test('includes published and created timestamps', () => {
    const note = formatClippingNote(bookmarkWithoutLink);
    assert.ok(note.includes('published: 2026-01-26'), 'Should have tweet date as published');
    assert.ok(note.includes('created:'), 'Should have created field');
    // created should be current time, not the tweet time
    assert.ok(!note.match(/created:.*2026-01-26T10:30/), 'created should be clip time, not tweet time');
  });

  test('includes topics field', () => {
    const note = formatClippingNote(bookmarkWithLink);
    assert.ok(note.includes('topics: []'), 'Should have topics field');
  });

  test('generates title heading', () => {
    const note = formatClippingNote(bookmarkWithLink);
    assert.ok(note.includes('# Why We Built Our Own Background Agent'), 'Should have title as H1');
  });

  test('generates title from tweet when no link', () => {
    const note = formatClippingNote(bookmarkWithoutLink);
    assert.ok(note.includes('# @dhh - Just shipped Rails 8'), 'Should have @author - first sentence in title');
  });
});

describe('writeClippingNote', () => {
  const testVaultPath = path.join(os.tmpdir(), `smaug-test-vault-${Date.now()}`);

  test('creates Clippings directory if not exists', () => {
    const result = writeClippingNote(testVaultPath, bookmarkWithoutLink);

    const clippingsDir = path.join(testVaultPath, 'Clippings');
    assert.ok(fs.existsSync(clippingsDir), 'Clippings directory should exist');

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  test('writes note file with correct content', () => {
    const result = writeClippingNote(testVaultPath, bookmarkWithoutLink);

    assert.ok(fs.existsSync(result.filePath), 'Note file should exist');

    const content = fs.readFileSync(result.filePath, 'utf8');
    assert.ok(content.includes('[[@dhh]]'), 'File should contain author');
    assert.ok(content.includes('Just shipped Rails 8'), 'File should contain content');

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  test('returns file path and content', () => {
    const result = writeClippingNote(testVaultPath, bookmarkWithoutLink);

    assert.ok(result.filePath, 'Should return filePath');
    assert.ok(result.content, 'Should return content');
    assert.ok(result.filename, 'Should return filename');
    assert.ok(result.filePath.endsWith('.md'), 'File path should end with .md');

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  test('handles custom clippings folder', () => {
    const result = writeClippingNote(testVaultPath, bookmarkWithoutLink, { clippingsFolder: 'CustomClippings' });

    assert.ok(result.filePath.includes('CustomClippings'), 'Should use custom folder');

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  test('throws error when vault path is not provided', () => {
    assert.throws(
      () => writeClippingNote(null, bookmarkWithoutLink),
      { message: 'Vault path is required' }
    );

    assert.throws(
      () => writeClippingNote('', bookmarkWithoutLink),
      { message: 'Vault path is required' }
    );
  });

  test('wraps file operation errors with context', () => {
    // Try to write to an invalid path (root directory, should fail on most systems)
    const invalidPath = '/nonexistent-root-path-that-should-fail';

    assert.throws(
      () => writeClippingNote(invalidPath, bookmarkWithoutLink),
      /Failed to write note/
    );
  });

  test('skips duplicate notes by source URL', () => {
    // Write the first note
    const result1 = writeClippingNote(testVaultPath, bookmarkWithLink);
    assert.strictEqual(result1.skipped, false, 'First note should not be skipped');

    // Try to write the same bookmark again
    const result2 = writeClippingNote(testVaultPath, bookmarkWithLink);
    assert.strictEqual(result2.skipped, true, 'Duplicate note should be skipped');
    assert.strictEqual(result2.reason, 'duplicate', 'Should indicate duplicate reason');

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  test('allows duplicates when skipDuplicates is false', () => {
    // Write the first note
    const result1 = writeClippingNote(testVaultPath, bookmarkWithLink);
    assert.strictEqual(result1.skipped, false);

    // Write again with skipDuplicates: false
    const result2 = writeClippingNote(testVaultPath, bookmarkWithLink, { skipDuplicates: false });
    assert.strictEqual(result2.skipped, false, 'Should allow duplicate when skipDuplicates is false');

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });
});

describe('findExistingNoteBySource', () => {
  const testVaultPath = path.join(os.tmpdir(), `smaug-test-vault-dup-${Date.now()}`);

  test('returns null for non-existent directory', () => {
    const result = findExistingNoteBySource('/nonexistent/path', 'https://example.com');
    assert.strictEqual(result, null);
  });

  test('returns null when no matching url found', () => {
    const clippingsDir = path.join(testVaultPath, 'Clippings');
    fs.mkdirSync(clippingsDir, { recursive: true });
    fs.writeFileSync(path.join(clippingsDir, 'test.md'), '---\nurl: "https://other.com"\n---\n');

    const result = findExistingNoteBySource(clippingsDir, 'https://example.com');
    assert.strictEqual(result, null);

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });

  test('returns path when matching url found', () => {
    const clippingsDir = path.join(testVaultPath, 'Clippings');
    fs.mkdirSync(clippingsDir, { recursive: true });
    const notePath = path.join(clippingsDir, 'existing.md');
    fs.writeFileSync(notePath, '---\nurl: "https://example.com/article"\n---\nContent');

    const result = findExistingNoteBySource(clippingsDir, 'https://example.com/article');
    assert.strictEqual(result, notePath);

    // Cleanup
    fs.rmSync(testVaultPath, { recursive: true, force: true });
  });
});
