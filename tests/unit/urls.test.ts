import { describe, expect, it } from 'vitest';
import {
  canonicalStatusUrl,
  extractStatusRef,
  normalizeHandle,
  profileUrl,
  searchUrl,
} from '../../src/x/urls.js';

describe('extractStatusRef', () => {
  it('parses a full x.com status URL', () => {
    expect(extractStatusRef('https://x.com/alice/status/123456789?s=20')).toEqual({
      statusId: '123456789',
      handle: 'alice',
    });
  });

  it('parses twitter.com and photo sub-paths', () => {
    expect(extractStatusRef('https://twitter.com/alice/status/123/photo/1')).toEqual({
      statusId: '123',
      handle: 'alice',
    });
  });

  it('parses /i/web/status URLs without a handle', () => {
    expect(extractStatusRef('https://x.com/i/web/status/999')).toEqual({ statusId: '999' });
  });

  it('accepts a bare numeric status ID', () => {
    expect(extractStatusRef('123456789012345')).toEqual({ statusId: '123456789012345' });
  });

  it('rejects garbage and non-X URLs', () => {
    expect(extractStatusRef('hello world')).toBeNull();
    expect(extractStatusRef('https://example.com/alice/status/123')).toBeNull();
  });
});

describe('canonicalStatusUrl', () => {
  it('builds a handle URL when the handle is known', () => {
    expect(canonicalStatusUrl('123', 'alice')).toBe('https://x.com/alice/status/123');
  });

  it('falls back to /i/web when the handle is unknown', () => {
    expect(canonicalStatusUrl('123')).toBe('https://x.com/i/web/status/123');
  });
});

describe('normalizeHandle', () => {
  it('strips the @ prefix', () => {
    expect(normalizeHandle('@alice')).toBe('alice');
  });

  it('accepts a bare handle', () => {
    expect(normalizeHandle('alice_123')).toBe('alice_123');
  });

  it('extracts the handle from a profile URL', () => {
    expect(normalizeHandle('https://x.com/alice')).toBe('alice');
    expect(normalizeHandle('https://twitter.com/alice/')).toBe('alice');
  });

  it('rejects invalid handles', () => {
    expect(normalizeHandle('way_too_long_handle_over_15')).toBeNull();
    expect(normalizeHandle('has space')).toBeNull();
    expect(normalizeHandle('')).toBeNull();
    expect(normalizeHandle('https://x.com/alice/status/123')).toBeNull();
  });
});

describe('profileUrl and searchUrl', () => {
  it('builds a profile URL', () => {
    expect(profileUrl('alice')).toBe('https://x.com/alice');
  });

  it('builds a latest-sorted search URL with encoded query', () => {
    const url = searchUrl('MCP browser automation', 'latest');
    expect(url).toContain('https://x.com/search?');
    expect(url).toContain('q=MCP%20browser%20automation');
    expect(url).toContain('f=live');
  });

  it('omits the live filter for top results', () => {
    expect(searchUrl('hello', 'top')).not.toContain('f=live');
  });
});
