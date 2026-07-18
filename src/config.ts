import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const intInRange = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

const envSchema = z.object({
  X_BROWSER_HEADLESS: booleanString.default(false),
  X_BROWSER_PROFILE_DIR: z.string().min(1).default('.auth/x-profile'),
  X_BROWSER_CDP_URL: z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .pipe(z.url().optional())
    .optional(),
  X_BROWSER_CHANNEL: z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .pipe(z.enum(['chrome', 'chrome-beta', 'chrome-dev', 'msedge']).optional())
    .optional(),
  X_BROWSER_LOCALE: z.string().min(2).default('en-US'),
  X_BROWSER_TIMEOUT_MS: intInRange(1_000, 120_000).default(15_000),
  X_MAX_READ_ITEMS: intInRange(1, 100).default(20),
  X_MAX_POST_CHARS: intInRange(1, 25_000).default(25_000),
  X_ACTION_TOKEN_TTL_MS: intInRange(10_000, 600_000).default(120_000),
  X_WRITE_RATE_PER_HOUR: intInRange(1, 100).default(10),
  X_ARTIFACTS_DIR: z.string().min(1).default('artifacts'),
  X_SAVE_ERROR_ARTIFACTS: booleanString.default(false),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export interface AppConfig {
  browser: {
    /** CDP takes precedence over the persistent profile when both are set. */
    mode: 'cdp' | 'persistent';
    headless: boolean;
    profileDir: string;
    cdpUrl?: string;
    /**
     * Browser channel for persistent mode. Playwright's bundled Chromium has
     * no macOS keychain/passkey integration, so hardware keys and Touch ID
     * only work with a real system browser, e.g. "chrome".
     */
    channel?: 'chrome' | 'chrome-beta' | 'chrome-dev' | 'msedge';
    locale: string;
    timeoutMs: number;
  };
  limits: {
    maxReadItems: number;
    /**
     * Upper bound accepted at prepare time. Defaults to X Premium's 25 000;
     * the account's real limit is enforced by X's own compose UI at execute
     * time (PREMIUM_REQUIRED when a >280-char draft never enables the button).
     */
    maxPostChars: number;
    writeRatePerHour: number;
  };
  safety: {
    actionTokenTtlMs: number;
  };
  artifacts: {
    dir: string;
    saveErrorArtifacts: boolean;
  };
  logLevel: (typeof LOG_LEVELS)[number];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  const raw = parsed.data;
  return {
    browser: {
      mode: raw.X_BROWSER_CDP_URL ? 'cdp' : 'persistent',
      headless: raw.X_BROWSER_HEADLESS,
      profileDir: raw.X_BROWSER_PROFILE_DIR,
      ...(raw.X_BROWSER_CDP_URL !== undefined ? { cdpUrl: raw.X_BROWSER_CDP_URL } : {}),
      ...(raw.X_BROWSER_CHANNEL !== undefined ? { channel: raw.X_BROWSER_CHANNEL } : {}),
      locale: raw.X_BROWSER_LOCALE,
      timeoutMs: raw.X_BROWSER_TIMEOUT_MS,
    },
    limits: {
      maxReadItems: raw.X_MAX_READ_ITEMS,
      maxPostChars: raw.X_MAX_POST_CHARS,
      writeRatePerHour: raw.X_WRITE_RATE_PER_HOUR,
    },
    safety: {
      actionTokenTtlMs: raw.X_ACTION_TOKEN_TTL_MS,
    },
    artifacts: {
      dir: raw.X_ARTIFACTS_DIR,
      saveErrorArtifacts: raw.X_SAVE_ERROR_ARTIFACTS,
    },
    logLevel: raw.LOG_LEVEL,
  };
}

/**
 * Returns a copy safe for logging. The CDP URL may embed credentials or
 * one-time tokens, so it is never logged verbatim.
 */
export function redactConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    browser: {
      ...config.browser,
      ...(config.browser.cdpUrl !== undefined ? { cdpUrl: '[redacted]' } : {}),
    },
    limits: { ...config.limits },
    safety: { ...config.safety },
    artifacts: { ...config.artifacts },
  };
}
