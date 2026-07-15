import { z } from 'zod';

export const PostMediaSchema = z.object({
  type: z.literal('image'),
  url: z.string().nullable(),
  alt: z.string().nullable(),
});

export const PostMetricsSchema = z.object({
  replies: z.number().int().nonnegative().nullable(),
  reposts: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
});

export const QuotedPostSchema = z.object({
  statusId: z.string().nullable(),
  handle: z.string().nullable(),
  text: z.string().nullable(),
});

export const PostSchema = z.object({
  statusId: z.string().regex(/^\d+$/),
  url: z.string(),
  author: z.object({
    handle: z.string(),
    displayName: z.string().nullable(),
  }),
  text: z.string(),
  postedAt: z.string().nullable(),
  metrics: PostMetricsSchema,
  media: z.array(PostMediaSchema),
  isReply: z.boolean(),
  quotedPost: QuotedPostSchema.optional(),
});

export const ProfileSchema = z.object({
  handle: z.string(),
  url: z.string(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  location: z.string().nullable(),
  website: z.string().nullable(),
  joined: z.string().nullable(),
  followersCount: z.number().int().nonnegative().nullable(),
  followingCount: z.number().int().nonnegative().nullable(),
});

export type PostMedia = z.infer<typeof PostMediaSchema>;
export type PostMetrics = z.infer<typeof PostMetricsSchema>;
export type Post = z.infer<typeof PostSchema>;
export type Profile = z.infer<typeof ProfileSchema>;

/** Metadata attached to every read result. */
export interface ReadMeta {
  sourceUrl: string;
  observedAt: string;
  warnings: string[];
  truncated: boolean;
}
