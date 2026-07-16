import { describe, expect, it } from 'vitest';
import { loadConfig, redactConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('uses a persistent local profile by default', () => {
    const config = loadConfig({});
    expect(config.browser.mode).toBe('persistent');
    expect(config.browser.profileDir).toBe('.auth/x-profile');
    expect(config.browser.headless).toBe(false);
    expect(config.browser.locale).toBe('en-US');
  });

  it('prefers CDP over the persistent profile when both are configured', () => {
    const config = loadConfig({
      X_BROWSER_CDP_URL: 'http://127.0.0.1:9222',
      X_BROWSER_PROFILE_DIR: '/some/profile',
    });
    expect(config.browser.mode).toBe('cdp');
    expect(config.browser.cdpUrl).toBe('http://127.0.0.1:9222');
  });

  it('treats a blank CDP URL as unset', () => {
    const config = loadConfig({ X_BROWSER_CDP_URL: '   ' });
    expect(config.browser.mode).toBe('persistent');
    expect(config.browser.cdpUrl).toBeUndefined();
  });

  it('rejects a malformed CDP URL', () => {
    expect(() => loadConfig({ X_BROWSER_CDP_URL: 'not-a-url' })).toThrow(/X_BROWSER_CDP_URL/);
  });

  it('accepts a system browser channel and defaults to none', () => {
    expect(loadConfig({}).browser.channel).toBeUndefined();
    expect(loadConfig({ X_BROWSER_CHANNEL: '' }).browser.channel).toBeUndefined();
    expect(loadConfig({ X_BROWSER_CHANNEL: 'chrome' }).browser.channel).toBe('chrome');
  });

  it('rejects an unknown browser channel', () => {
    expect(() => loadConfig({ X_BROWSER_CHANNEL: 'firefox' })).toThrow(/X_BROWSER_CHANNEL/);
  });

  it('parses booleans and numbers from strings', () => {
    const config = loadConfig({
      X_BROWSER_HEADLESS: 'true',
      X_BROWSER_TIMEOUT_MS: '20000',
      X_MAX_READ_ITEMS: '5',
      X_SAVE_ERROR_ARTIFACTS: 'true',
    });
    expect(config.browser.headless).toBe(true);
    expect(config.browser.timeoutMs).toBe(20_000);
    expect(config.limits.maxReadItems).toBe(5);
    expect(config.artifacts.saveErrorArtifacts).toBe(true);
  });

  it('applies documented defaults for limits and safety', () => {
    const config = loadConfig({});
    expect(config.browser.timeoutMs).toBe(15_000);
    expect(config.limits.maxReadItems).toBe(20);
    expect(config.limits.writeRatePerHour).toBe(10);
    expect(config.safety.actionTokenTtlMs).toBe(120_000);
    expect(config.artifacts.dir).toBe('artifacts');
    expect(config.artifacts.saveErrorArtifacts).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('rejects out-of-range timeouts', () => {
    expect(() => loadConfig({ X_BROWSER_TIMEOUT_MS: '500' })).toThrow(/X_BROWSER_TIMEOUT_MS/);
    expect(() => loadConfig({ X_BROWSER_TIMEOUT_MS: '600000' })).toThrow(/X_BROWSER_TIMEOUT_MS/);
  });

  it('rejects out-of-range read and write limits', () => {
    expect(() => loadConfig({ X_MAX_READ_ITEMS: '0' })).toThrow(/X_MAX_READ_ITEMS/);
    expect(() => loadConfig({ X_MAX_READ_ITEMS: '101' })).toThrow(/X_MAX_READ_ITEMS/);
    expect(() => loadConfig({ X_WRITE_RATE_PER_HOUR: '0' })).toThrow(/X_WRITE_RATE_PER_HOUR/);
    expect(() => loadConfig({ X_WRITE_RATE_PER_HOUR: '1000' })).toThrow(/X_WRITE_RATE_PER_HOUR/);
  });

  it('rejects out-of-range confirmation TTL', () => {
    expect(() => loadConfig({ X_ACTION_TOKEN_TTL_MS: '999' })).toThrow(/X_ACTION_TOKEN_TTL_MS/);
    expect(() => loadConfig({ X_ACTION_TOKEN_TTL_MS: '9999999' })).toThrow(/X_ACTION_TOKEN_TTL_MS/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'shout' })).toThrow(/LOG_LEVEL/);
  });
});

describe('redactConfig', () => {
  it('redacts the CDP URL, which may embed tokens', () => {
    const config = loadConfig({ X_BROWSER_CDP_URL: 'http://user:secret@127.0.0.1:9222/devtools' });
    const redacted = redactConfig(config);
    expect(JSON.stringify(redacted)).not.toContain('secret');
    expect(redacted.browser.cdpUrl).toBe('[redacted]');
  });

  it('keeps non-sensitive fields readable', () => {
    const redacted = redactConfig(loadConfig({}));
    expect(redacted.browser.mode).toBe('persistent');
    expect(redacted.limits.maxReadItems).toBe(20);
  });

  it('does not mutate the original config', () => {
    const config = loadConfig({ X_BROWSER_CDP_URL: 'http://127.0.0.1:9222' });
    redactConfig(config);
    expect(config.browser.cdpUrl).toBe('http://127.0.0.1:9222');
  });
});
