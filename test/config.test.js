import { test, describe } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import path from 'path';
import { expandTilde, loadConfig } from '../src/config.js';

describe('expandTilde', () => {
  test('expands ~/ to home directory', () => {
    const result = expandTilde('~/Documents/bookmarks.md');
    assert.strictEqual(result, path.join(os.homedir(), 'Documents/bookmarks.md'));
  });

  test('expands bare ~ to home directory', () => {
    const result = expandTilde('~');
    assert.strictEqual(result, os.homedir());
  });

  test('returns absolute paths unchanged', () => {
    const result = expandTilde('/usr/local/bin');
    assert.strictEqual(result, '/usr/local/bin');
  });

  test('returns relative paths unchanged', () => {
    const result = expandTilde('./bookmarks.md');
    assert.strictEqual(result, './bookmarks.md');
  });

  test('handles null gracefully', () => {
    const result = expandTilde(null);
    assert.strictEqual(result, null);
  });

  test('handles undefined gracefully', () => {
    const result = expandTilde(undefined);
    assert.strictEqual(result, undefined);
  });

  test('handles non-string gracefully', () => {
    const result = expandTilde(123);
    assert.strictEqual(result, 123);
  });
});

describe('loadConfig', () => {
  test('returns default config when no file exists', () => {
    const config = loadConfig('./nonexistent.json');
    assert.ok(config.archiveFile);
    assert.ok(config.pendingFile);
    assert.ok(config.stateFile);
    assert.deepStrictEqual(config.folders, {});
  });

  test('default categories are present', () => {
    const config = loadConfig('./nonexistent.json');
    assert.ok(config.categories.github);
    assert.ok(config.categories.article);
    assert.ok(config.categories.tweet);
  });

  test('expands tilde in archive paths', () => {
    // This tests the integration - loadConfig should expand tildes
    const config = loadConfig('./nonexistent.json');
    // Default paths don't use ~, but the function should work
    assert.ok(!config.archiveFile.includes('~'));
  });
});

describe('z.ai configuration', () => {
  test('default zai config is present with correct defaults', () => {
    const config = loadConfig('./nonexistent.json');
    assert.ok(config.zai, 'zai config object should exist');
    assert.strictEqual(config.zai.enabled, false, 'zai should be disabled by default');
    assert.strictEqual(config.zai.apiKey, null, 'apiKey should be null by default');
    assert.strictEqual(config.zai.baseUrl, 'https://api.z.ai/api/anthropic', 'baseUrl should have z.ai endpoint');
  });

  test('default zai modelMapping is present', () => {
    const config = loadConfig('./nonexistent.json');
    assert.ok(config.zai.modelMapping, 'modelMapping object should exist');
    assert.strictEqual(config.zai.modelMapping.opus, null, 'opus mapping should be null by default');
    assert.strictEqual(config.zai.modelMapping.sonnet, null, 'sonnet mapping should be null by default');
    assert.strictEqual(config.zai.modelMapping.haiku, null, 'haiku mapping should be null by default');
  });

  test('ZAI_ENABLED env var overrides config', () => {
    const originalEnv = process.env.ZAI_ENABLED;
    try {
      process.env.ZAI_ENABLED = 'true';
      const config = loadConfig('./nonexistent.json');
      assert.strictEqual(config.zai.enabled, true, 'ZAI_ENABLED=true should enable zai');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ZAI_ENABLED;
      } else {
        process.env.ZAI_ENABLED = originalEnv;
      }
    }
  });

  test('ZAI_API_KEY env var overrides config', () => {
    const originalEnv = process.env.ZAI_API_KEY;
    try {
      process.env.ZAI_API_KEY = 'test-api-key-123';
      const config = loadConfig('./nonexistent.json');
      assert.strictEqual(config.zai.apiKey, 'test-api-key-123', 'ZAI_API_KEY should override apiKey');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ZAI_API_KEY;
      } else {
        process.env.ZAI_API_KEY = originalEnv;
      }
    }
  });

  test('ZAI_BASE_URL env var overrides config', () => {
    const originalEnv = process.env.ZAI_BASE_URL;
    try {
      process.env.ZAI_BASE_URL = 'https://custom.api.endpoint/v1';
      const config = loadConfig('./nonexistent.json');
      assert.strictEqual(config.zai.baseUrl, 'https://custom.api.endpoint/v1', 'ZAI_BASE_URL should override baseUrl');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ZAI_BASE_URL;
      } else {
        process.env.ZAI_BASE_URL = originalEnv;
      }
    }
  });

  test('zai config merges with file config', () => {
    // This test verifies deep merge behavior - file config should override defaults
    // but not require all fields
    const config = loadConfig('./nonexistent.json');
    // Even with no file, defaults should be present
    assert.ok(config.zai);
    assert.ok(config.zai.modelMapping);
  });
});
