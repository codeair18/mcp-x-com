import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveErrorScreenshot } from '../../src/browser/artifacts.js';

describe('saveErrorScreenshot', () => {
  let dir: string;
  const fakePage = {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'x-mcp-artifacts-'));
    fakePage.screenshot.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does nothing when error artifacts are disabled (the default)', async () => {
    const result = await saveErrorScreenshot(
      fakePage,
      { dir, saveErrorArtifacts: false },
      'test-label',
    );
    expect(result).toBeNull();
    expect(fakePage.screenshot).not.toHaveBeenCalled();
  });

  it('saves a screenshot when explicitly enabled', async () => {
    const result = await saveErrorScreenshot(
      fakePage,
      { dir, saveErrorArtifacts: true },
      'test-label',
    );
    expect(result).not.toBeNull();
    expect(result).toContain('test-label');
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
  });

  it('never throws when the screenshot fails', async () => {
    fakePage.screenshot.mockRejectedValueOnce(new Error('page gone'));
    const result = await saveErrorScreenshot(
      fakePage,
      { dir, saveErrorArtifacts: true },
      'test-label',
    );
    expect(result).toBeNull();
  });
});
