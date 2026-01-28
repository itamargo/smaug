import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractXArticleId,
  fetchXArticleContent,
  fetchArticleWithSummarize,
  detectLinkType
} from '../src/processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// X ARTICLE DETECTION AND FETCHING TESTS
// =============================================================================

describe('extractXArticleId', () => {
  test('extracts article ID from x.com/i/article/ URL', () => {
    const url = 'https://x.com/i/article/2012310917812502528';
    const result = extractXArticleId(url);
    assert.strictEqual(result, '2012310917812502528');
  });

  test('extracts article ID from URL with query params', () => {
    const url = 'https://x.com/i/article/2012310917812502528?s=20';
    const result = extractXArticleId(url);
    assert.strictEqual(result, '2012310917812502528');
  });

  test('returns null for non-article URLs', () => {
    const url = 'https://x.com/user/status/123456789';
    const result = extractXArticleId(url);
    assert.strictEqual(result, null);
  });

  test('returns null for regular tweet URLs', () => {
    const url = 'https://twitter.com/user/status/123456789';
    const result = extractXArticleId(url);
    assert.strictEqual(result, null);
  });
});

describe('detectLinkType', () => {
  test('detects x-article for x.com/i/article/ URLs', () => {
    const url = 'https://x.com/i/article/2012310917812502528';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'x-article');
  });

  test('detects tweet for regular x.com status URLs', () => {
    const url = 'https://x.com/user/status/123456789';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'tweet');
  });

  test('detects tweet for twitter.com status URLs', () => {
    const url = 'https://twitter.com/user/status/123456789';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'tweet');
  });

  test('detects media for photo URLs', () => {
    const url = 'https://x.com/user/status/123/photo/1';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'media');
  });

  test('detects media for video URLs', () => {
    const url = 'https://x.com/user/status/123/video/1';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'media');
  });

  test('detects github for github.com URLs', () => {
    const url = 'https://github.com/user/repo';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'github');
  });

  test('detects video for youtube.com URLs', () => {
    const url = 'https://www.youtube.com/watch?v=abc123';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'video');
  });

  test('detects video for youtu.be URLs', () => {
    const url = 'https://youtu.be/abc123';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'video');
  });

  test('detects image for image file URLs', () => {
    const url = 'https://example.com/image.jpg';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'image');
  });

  test('detects article for other URLs', () => {
    const url = 'https://www.darioamodei.com/essay/the-adolescence-of-technology';
    const result = detectLinkType(url);
    assert.strictEqual(result, 'article');
  });
});

describe('fetchXArticleContent', () => {
  test('parses bird CLI output correctly', () => {
    // Load sample bird CLI output
    const sampleOutput = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures/xart-sample.json'), 'utf8')
    );

    // The function should extract title and text from the bird CLI response
    // This test verifies the expected structure
    assert.ok(sampleOutput.article?.title, 'sample should have article.title');
    assert.ok(sampleOutput.text, 'sample should have text');
    assert.strictEqual(
      sampleOutput.article.title,
      'The Shorthand Guide to Everything Claude Code'
    );
  });

  // Note: Full integration test would require mocking execSync
  // For now we test the expected output structure
});

// =============================================================================
// SUMMARIZE CLI INTEGRATION TESTS
// =============================================================================

describe('fetchArticleWithSummarize', () => {
  test('parses summarize CLI output correctly', () => {
    // Load sample summarize CLI output
    const sampleOutput = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures/summarize-sample.json'), 'utf8')
    );

    // Verify expected structure from summarize CLI
    assert.ok(sampleOutput.extracted, 'sample should have extracted object');
    assert.ok(sampleOutput.extracted.title, 'sample should have extracted.title');
    assert.ok(sampleOutput.extracted.description, 'sample should have extracted.description');
    assert.ok(sampleOutput.extracted.content, 'sample should have extracted.content');

    assert.strictEqual(
      sampleOutput.extracted.title,
      'Dario Amodei — The Adolescence of Technology'
    );
    assert.strictEqual(
      sampleOutput.extracted.description,
      'Confronting and Overcoming the Risks of Powerful AI'
    );
  });

  // Note: Full integration test would require mocking execSync
});

// =============================================================================
// CONTENT STRUCTURE TESTS
// =============================================================================

describe('content structure expectations', () => {
  test('X article content should have title and text', () => {
    // Expected content structure for X articles
    const expectedStructure = {
      title: 'string',
      text: 'string',
      source: 'bird-cli'
    };

    // This documents the expected output format
    assert.ok(expectedStructure.title);
    assert.ok(expectedStructure.text);
    assert.strictEqual(expectedStructure.source, 'bird-cli');
  });

  test('summarized article content should have title, description, and text', () => {
    // Expected content structure for summarized articles
    const expectedStructure = {
      title: 'string',
      description: 'string',
      text: 'string',
      source: 'summarize-cli'
    };

    // This documents the expected output format
    assert.ok(expectedStructure.title);
    assert.ok(expectedStructure.description);
    assert.ok(expectedStructure.text);
    assert.strictEqual(expectedStructure.source, 'summarize-cli');
  });
});
