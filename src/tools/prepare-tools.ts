import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WriteService } from '../x/write-service.js';
import { runTool } from './register-tools.js';

/**
 * Prepare tools change nothing on X — they validate, snapshot the intended
 * action, and return a single-use confirmation token. The actual state
 * change happens only in x_execute_action.
 */
const PREPARE_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const CONFIRM_FLOW =
  'Nothing is published yet: show the returned preview to the user, and only after their explicit approval call x_execute_action with the confirmationToken and the requiredPhrase. The token is single-use and expires.';

const mediaSchema = z
  .array(z.string())
  .max(4)
  .optional()
  .describe('Absolute paths of up to 4 local images (png/jpg/jpeg/gif/webp, max 5 MB each)');
const targetSchema = z.string().describe('Post URL (x.com/twitter.com) or bare status ID');

export function registerPrepareTools(server: McpServer, writeService: WriteService): void {
  const textSchema = z
    .string()
    .min(1)
    .max(writeService.maxPostChars)
    .describe(
      `Post text (max ${writeService.maxPostChars} characters; accounts without X Premium are limited to 280 by X itself — longer drafts fail at execute with PREMIUM_REQUIRED)`,
    );
  server.registerTool(
    'x_prepare_post',
    {
      description: `Prepare publishing a new post. ${CONFIRM_FLOW}`,
      inputSchema: { text: textSchema, mediaPaths: mediaSchema },
      annotations: PREPARE_ANNOTATIONS,
    },
    ({ text, mediaPaths }) =>
      runTool(() =>
        writeService.preparePost({ text, ...(mediaPaths ? { mediaPaths } : {}) }),
      ),
  );

  server.registerTool(
    'x_prepare_reply',
    {
      description: `Prepare replying to an existing post. ${CONFIRM_FLOW}`,
      inputSchema: { target: targetSchema, text: textSchema, mediaPaths: mediaSchema },
      annotations: PREPARE_ANNOTATIONS,
    },
    ({ target, text, mediaPaths }) =>
      runTool(() =>
        writeService.prepareReply({ target, text, ...(mediaPaths ? { mediaPaths } : {}) }),
      ),
  );

  server.registerTool(
    'x_prepare_like',
    {
      description: `Prepare liking a post. ${CONFIRM_FLOW}`,
      inputSchema: { target: targetSchema },
      annotations: PREPARE_ANNOTATIONS,
    },
    ({ target }) => runTool(() => writeService.prepareLike({ target })),
  );

  server.registerTool(
    'x_prepare_repost',
    {
      description: `Prepare reposting a post. ${CONFIRM_FLOW}`,
      inputSchema: { target: targetSchema },
      annotations: PREPARE_ANNOTATIONS,
    },
    ({ target }) => runTool(() => writeService.prepareRepost({ target })),
  );

  server.registerTool(
    'x_prepare_follow',
    {
      description: `Prepare following a profile. ${CONFIRM_FLOW}`,
      inputSchema: {
        handle: z.string().describe('Handle ("@user" or "user") or profile URL'),
      },
      annotations: PREPARE_ANNOTATIONS,
    },
    ({ handle }) => runTool(() => writeService.prepareFollow({ handle })),
  );

  server.registerTool(
    'x_prepare_delete_post',
    {
      description: `Prepare deleting one of the active account's posts. Deletion is irreversible, so the required phrase is "DELETE <postId>", not "CONFIRM". ${CONFIRM_FLOW}`,
      inputSchema: { target: targetSchema },
      annotations: PREPARE_ANNOTATIONS,
    },
    ({ target }) => runTool(() => writeService.prepareDeletePost({ target })),
  );
}
