import type { Page } from 'playwright';
import { SELECTORS } from '../browser/selectors.js';
import { canonicalStatusUrl, extractStatusRef, profileUrl } from './urls.js';
import { PostSchema, ProfileSchema, type Post, type Profile } from './types.js';

/**
 * Parses a human-formatted count out of text such as "1,234 reposts. Repost"
 * or "5.3K Likes". Returns null when no count is present.
 */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) {
    return null;
  }
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*([KMB])?/i);
  if (!match?.[1]) {
    return null;
  }
  const base = Number(match[1].replaceAll(',', ''));
  if (Number.isNaN(base)) {
    return null;
  }
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[
    match[2]?.toUpperCase() ?? ''
  ];
  return Math.round(base * (multiplier ?? 1));
}

export function dedupeByStatusId<T extends { statusId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.statusId)) {
      return false;
    }
    seen.add(item.statusId);
    return true;
  });
}

/** Raw article data extracted inside the browser before validation. */
interface RawArticle {
  statusHref: string | null;
  datetime: string | null;
  handle: string | null;
  displayName: string | null;
  text: string;
  replyLabel: string | null;
  repostLabel: string | null;
  likeLabel: string | null;
  media: { url: string | null; alt: string | null }[];
  quoted: { statusHref: string | null; handle: string | null; text: string | null } | null;
  isReply: boolean;
}

/**
 * Parses up to `limit` tweet articles from the current page. Articles that
 * cannot be parsed into a valid post (e.g. ads or placeholders without a
 * status link) are skipped, not errors.
 */
export async function parseTweetArticles(page: Page, limit: number): Promise<Post[]> {
  const raw = await page.locator(SELECTORS.post.article).evaluateAll(
    (articles, { limit: max, sel }): RawArticle[] =>
      articles.slice(0, max).map((article) => {
        // Quoted posts are embedded link cards; everything inside them must
        // not be confused with the outer post's own fields.
        const inQuote = (el: Element): boolean => {
          const container = el.closest(sel.quoteContainer);
          return container !== null && article.contains(container) && container !== article;
        };
        const queryOwn = (selector: string): Element[] =>
          Array.from(article.querySelectorAll(selector)).filter((el) => !inQuote(el));

        const statusLink = queryOwn(sel.statusLink).find((a) => a.querySelector('time'));
        const readUser = (root: Element | undefined) => {
          const spans = Array.from(root?.querySelectorAll('a span') ?? [])
            .map((s) => s.textContent?.trim() ?? '')
            .filter((t) => t.length > 0);
          const handleText = spans.find((t) => t.startsWith('@'));
          return {
            handle: handleText ? handleText.slice(1) : null,
            displayName: spans.find((t) => !t.startsWith('@')) ?? null,
          };
        };
        const user = readUser(queryOwn(sel.userName)[0]);

        const label = (selector: string): string | null =>
          queryOwn(selector)[0]?.getAttribute('aria-label') ?? null;

        const quoteContainer = Array.from(article.querySelectorAll(sel.quoteContainer)).find(
          (el) => el !== article && el.querySelector(sel.tweetText),
        );
        let quoted: RawArticle['quoted'] = null;
        if (quoteContainer) {
          const quoteLink = Array.from(quoteContainer.querySelectorAll(sel.statusLink)).find(
            (a) => a.querySelector('time'),
          );
          quoted = {
            statusHref: quoteLink?.getAttribute('href') ?? null,
            handle: readUser(quoteContainer.querySelector(sel.userName) ?? undefined).handle,
            text: quoteContainer.querySelector(sel.tweetText)?.textContent?.trim() ?? null,
          };
        }

        return {
          statusHref: statusLink?.getAttribute('href') ?? null,
          datetime: statusLink?.querySelector('time')?.getAttribute('datetime') ?? null,
          handle: user.handle,
          displayName: user.displayName,
          text: queryOwn(sel.tweetText)[0]?.textContent?.trim() ?? '',
          replyLabel: label(sel.replyButton),
          repostLabel: label(sel.repostButton),
          likeLabel: label(sel.likeButton),
          media: queryOwn(sel.photoImg).map((img) => ({
            url: img.getAttribute('src'),
            alt: img.getAttribute('alt') || null,
          })),
          quoted,
          // Text markers are locale-dependent, but this is only a hint flag.
          isReply: /Replying to/i.test(article.textContent ?? ''),
        };
      }),
    { limit, sel: SELECTORS.post },
  );

  const posts: Post[] = [];
  for (const item of raw) {
    const ref = item.statusHref ? extractStatusRef(`https://x.com${item.statusHref}`) : null;
    if (!ref || !item.handle) {
      continue;
    }
    const quotedRef = item.quoted?.statusHref
      ? extractStatusRef(`https://x.com${item.quoted.statusHref}`)
      : null;
    const candidate = {
      statusId: ref.statusId,
      url: canonicalStatusUrl(ref.statusId, ref.handle ?? item.handle),
      author: { handle: item.handle, displayName: item.displayName },
      text: item.text,
      postedAt: item.datetime,
      metrics: {
        replies: parseCount(item.replyLabel),
        reposts: parseCount(item.repostLabel),
        likes: parseCount(item.likeLabel),
      },
      media: item.media.map((m) => ({ type: 'image' as const, url: m.url, alt: m.alt })),
      isReply: item.isReply,
      ...(item.quoted
        ? {
            quotedPost: {
              statusId: quotedRef?.statusId ?? null,
              handle: item.quoted.handle,
              text: item.quoted.text,
            },
          }
        : {}),
    };
    const parsed = PostSchema.safeParse(candidate);
    if (parsed.success) {
      posts.push(parsed.data);
    }
  }
  return posts;
}

/** Parses the profile header of the currently open profile page. */
export async function parseProfilePage(page: Page, handle: string): Promise<Profile> {
  const sel = SELECTORS.profile;
  const textOf = async (selector: string): Promise<string | null> => {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      return null;
    }
    const text = await locator.textContent();
    return text?.trim() || null;
  };

  const displayNameRaw = await page
    .locator(sel.userName)
    .first()
    .locator('span')
    .allTextContents()
    .catch(() => [] as string[]);
  const displayName =
    displayNameRaw.map((t) => t.trim()).find((t) => t.length > 0 && !t.startsWith('@')) ?? null;

  const website = await page
    .locator(sel.website)
    .first()
    .getAttribute('href')
    .catch(() => null);

  const candidate = {
    handle,
    url: profileUrl(handle),
    displayName,
    bio: await textOf(sel.description),
    location: await textOf(sel.location),
    website,
    joined: await textOf(sel.joinDate),
    followersCount: parseCount(await textOf(sel.followersLink)),
    followingCount: parseCount(await textOf(sel.followingLink)),
  };
  return ProfileSchema.parse(candidate);
}
