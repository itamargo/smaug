import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildClaudeEnv } from '../src/job.js';

describe('buildClaudeEnv', () => {
  const baseEnv = { HOME: '/home/user', TERM: 'xterm' };
  const enhancedPath = '/usr/local/bin:/usr/bin';

  test('passes ANTHROPIC_API_KEY when zai disabled and apiKey provided', () => {
    const config = {
      zai: { enabled: false, apiKey: null, baseUrl: 'https://api.z.ai/api/anthropic', modelMapping: {} }
    };
    const anthropicApiKey = 'sk-ant-api123';

    const env = buildClaudeEnv(config, baseEnv, enhancedPath, anthropicApiKey);

    assert.strictEqual(env.ANTHROPIC_API_KEY, 'sk-ant-api123');
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.strictEqual(env.ANTHROPIC_BASE_URL, undefined);
  });

  test('passes z.ai env vars when zai enabled', () => {
    const config = {
      zai: {
        enabled: true,
        apiKey: 'zai-key-123',
        baseUrl: 'https://api.z.ai/api/anthropic',
        modelMapping: { opus: null, sonnet: null, haiku: null }
      }
    };

    const env = buildClaudeEnv(config, baseEnv, enhancedPath, null);

    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, 'zai-key-123');
    assert.strictEqual(env.ANTHROPIC_BASE_URL, 'https://api.z.ai/api/anthropic');
    assert.strictEqual(env.ANTHROPIC_API_KEY, undefined, 'Should not pass ANTHROPIC_API_KEY when zai enabled');
  });

  test('passes model mapping overrides when specified', () => {
    const config = {
      zai: {
        enabled: true,
        apiKey: 'zai-key-123',
        baseUrl: 'https://api.z.ai/api/anthropic',
        modelMapping: {
          opus: 'GLM-4.5',
          sonnet: 'GLM-4.5-Air',
          haiku: null  // null means use default
        }
      }
    };

    const env = buildClaudeEnv(config, baseEnv, enhancedPath, null);

    assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'GLM-4.5');
    assert.strictEqual(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'GLM-4.5-Air');
    assert.strictEqual(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined, 'Should not set haiku override when null');
  });

  test('does not pass Anthropic API key when zai enabled (even if provided)', () => {
    const config = {
      zai: {
        enabled: true,
        apiKey: 'zai-key-123',
        baseUrl: 'https://api.z.ai/api/anthropic',
        modelMapping: {}
      }
    };
    const anthropicApiKey = 'sk-ant-should-not-use';

    const env = buildClaudeEnv(config, baseEnv, enhancedPath, anthropicApiKey);

    assert.strictEqual(env.ANTHROPIC_API_KEY, undefined, 'Should not pass Anthropic key when zai enabled');
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, 'zai-key-123');
  });

  test('preserves base environment and PATH', () => {
    const config = {
      zai: { enabled: false, apiKey: null, baseUrl: null, modelMapping: {} }
    };

    const env = buildClaudeEnv(config, baseEnv, enhancedPath, null);

    assert.strictEqual(env.HOME, '/home/user');
    assert.strictEqual(env.TERM, 'xterm');
    assert.strictEqual(env.PATH, enhancedPath);
  });

  test('uses custom baseUrl when provided', () => {
    const config = {
      zai: {
        enabled: true,
        apiKey: 'key',
        baseUrl: 'https://custom.endpoint/v1',
        modelMapping: {}
      }
    };

    const env = buildClaudeEnv(config, baseEnv, enhancedPath, null);

    assert.strictEqual(env.ANTHROPIC_BASE_URL, 'https://custom.endpoint/v1');
  });
});
