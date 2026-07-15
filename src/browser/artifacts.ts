import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';

/** The minimal surface needed from a Playwright page for screenshots. */
export interface ScreenshotSource {
  screenshot(): Promise<Buffer>;
}

/**
 * Saves a screenshot of the failing page, but only when the user opted in
 * via X_SAVE_ERROR_ARTIFACTS. Screenshots may contain private timeline
 * content, so the default is to save nothing. Never throws.
 */
export async function saveErrorScreenshot(
  page: ScreenshotSource,
  config: AppConfig['artifacts'],
  label: string,
): Promise<string | null> {
  if (!config.saveErrorArtifacts) {
    return null;
  }
  try {
    const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeLabel}.png`;
    await mkdir(config.dir, { recursive: true });
    const filePath = join(config.dir, fileName);
    await writeFile(filePath, await page.screenshot());
    return filePath;
  } catch {
    return null;
  }
}
