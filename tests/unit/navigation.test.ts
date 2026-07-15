import { describe, expect, it } from 'vitest';
import { assertAllowedUrl, isAllowedUrl } from '../../src/browser/navigation.js';

describe('isAllowedUrl', () => {
  it('allows x.com and twitter.com over https', () => {
    expect(isAllowedUrl('https://x.com/home')).toBe(true);
    expect(isAllowedUrl('https://twitter.com/home')).toBe(true);
    expect(isAllowedUrl('https://mobile.x.com/home')).toBe(true);
  });

  it('allows local fixtures and blank pages', () => {
    expect(isAllowedUrl('file:///tmp/fixtures/x-post.html')).toBe(true);
    expect(isAllowedUrl('about:blank')).toBe(true);
  });

  it('blocks other domains', () => {
    expect(isAllowedUrl('https://example.com')).toBe(false);
    expect(isAllowedUrl('https://evil-x.com')).toBe(false);
    expect(isAllowedUrl('https://x.com.evil.com')).toBe(false);
  });

  it('blocks plain http to x.com', () => {
    expect(isAllowedUrl('http://x.com/home')).toBe(false);
  });

  it('blocks unparseable URLs', () => {
    expect(isAllowedUrl('not a url')).toBe(false);
  });

  it('assertAllowedUrl throws for blocked URLs', () => {
    expect(() => assertAllowedUrl('https://example.com')).toThrow(/not allowed/i);
    expect(() => assertAllowedUrl('https://x.com/home')).not.toThrow();
  });
});
