import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { findClaude, getPathSeparator, buildClaudeEnv } from '../src/job.js';

describe('findClaude', () => {
  describe('Unix/macOS', () => {
    test('returns default "claude" when no paths exist and which fails', () => {
      const result = findClaude({
        platform: 'darwin',
        env: { HOME: '/Users/test' },
        existsSync: () => false,
        execSyncFn: () => { throw new Error('not found'); }
      });
      assert.strictEqual(result, 'claude');
    });

    test('finds claude in /usr/local/bin', () => {
      const result = findClaude({
        platform: 'darwin',
        env: { HOME: '/Users/test' },
        existsSync: (p) => p === '/usr/local/bin/claude',
        execSyncFn: () => { throw new Error('not found'); }
      });
      assert.strictEqual(result, '/usr/local/bin/claude');
    });

    test('finds claude in homebrew path', () => {
      const result = findClaude({
        platform: 'darwin',
        env: { HOME: '/Users/test' },
        existsSync: (p) => p === '/opt/homebrew/bin/claude',
        execSyncFn: () => { throw new Error('not found'); }
      });
      assert.strictEqual(result, '/opt/homebrew/bin/claude');
    });

    test('finds claude via which command', () => {
      const result = findClaude({
        platform: 'darwin',
        env: { HOME: '/Users/test' },
        existsSync: () => false,
        execSyncFn: (cmd) => {
          assert.strictEqual(cmd, 'which claude');
          return '/some/custom/path/claude\n';
        }
      });
      assert.strictEqual(result, '/some/custom/path/claude');
    });

    test('uses which (not where) on Unix', () => {
      let commandUsed = null;
      findClaude({
        platform: 'linux',
        env: { HOME: '/home/test' },
        existsSync: () => false,
        execSyncFn: (cmd) => {
          commandUsed = cmd;
          throw new Error('not found');
        }
      });
      assert.strictEqual(commandUsed, 'which claude');
    });
  });

  describe('Windows', () => {
    test('checks Windows-specific paths on win32', () => {
      const checkedPaths = [];
      findClaude({
        platform: 'win32',
        env: {
          HOME: 'C:\\Users\\test',
          APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          USERPROFILE: 'C:\\Users\\test',
          PROGRAMFILES: 'C:\\Program Files'
        },
        existsSync: (p) => {
          checkedPaths.push(p);
          return false;
        },
        execSyncFn: () => { throw new Error('not found'); }
      });

      // Should check Windows paths
      assert.ok(
        checkedPaths.some(p => p.includes('npm') && p.includes('claude.cmd')),
        'should check npm claude.cmd path'
      );
      assert.ok(
        checkedPaths.some(p => p.includes('claude.exe')),
        'should check .exe paths'
      );
    });

    test('finds claude.cmd in npm directory', () => {
      // Note: path.join on Unix will use forward slashes, so we need to match
      // what path.join actually produces, not Windows-native paths
      const appdata = 'C:\\Users\\test\\AppData\\Roaming';
      const expectedPath = path.join(appdata, 'npm', 'claude.cmd');
      const result = findClaude({
        platform: 'win32',
        env: {
          HOME: 'C:\\Users\\test',
          APPDATA: appdata,
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          USERPROFILE: 'C:\\Users\\test',
          PROGRAMFILES: 'C:\\Program Files'
        },
        existsSync: (p) => p === expectedPath,
        execSyncFn: () => { throw new Error('not found'); }
      });
      assert.strictEqual(result, expectedPath);
    });

    test('uses where (not which) on Windows', () => {
      let commandUsed = null;
      findClaude({
        platform: 'win32',
        env: {
          HOME: 'C:\\Users\\test',
          APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          USERPROFILE: 'C:\\Users\\test',
          PROGRAMFILES: 'C:\\Program Files'
        },
        existsSync: () => false,
        execSyncFn: (cmd) => {
          commandUsed = cmd;
          throw new Error('not found');
        }
      });
      assert.strictEqual(commandUsed, 'where claude');
    });

    test('handles where returning multiple lines (takes first)', () => {
      const result = findClaude({
        platform: 'win32',
        env: {
          HOME: 'C:\\Users\\test',
          APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
          USERPROFILE: 'C:\\Users\\test',
          PROGRAMFILES: 'C:\\Program Files'
        },
        existsSync: () => false,
        execSyncFn: () => 'C:\\First\\Path\\claude.cmd\nC:\\Second\\Path\\claude.cmd\n'
      });
      assert.strictEqual(result, 'C:\\First\\Path\\claude.cmd');
    });
  });
});

describe('getPathSeparator', () => {
  test('returns semicolon for Windows', () => {
    assert.strictEqual(getPathSeparator('win32'), ';');
  });

  test('returns colon for macOS', () => {
    assert.strictEqual(getPathSeparator('darwin'), ':');
  });

  test('returns colon for Linux', () => {
    assert.strictEqual(getPathSeparator('linux'), ':');
  });

  test('returns colon for unknown platforms', () => {
    assert.strictEqual(getPathSeparator('freebsd'), ':');
  });
});

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
