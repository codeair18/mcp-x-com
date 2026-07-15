/**
 * Every selector used against X lives here. X ships UI changes often; when
 * something breaks, this file is the single place to fix. Prefer stable
 * `data-testid` values, then roles/accessible names; visible text only as a
 * last resort because it changes with the UI locale.
 */
export const SELECTORS = {
  session: {
    accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
    avatarContainerPrefix: 'UserAvatar-Container-',
    profileLink: '[data-testid="AppTabBar_Profile_Link"]',
    loggedOutCta: '[data-testid="loginButton"], [data-testid="signupButton"]',
  },
  post: {
    article: 'article[data-testid="tweet"]',
    userName: '[data-testid="User-Name"]',
    tweetText: '[data-testid="tweetText"]',
    photoImg: '[data-testid="tweetPhoto"] img',
    replyButton: '[data-testid="reply"]',
    repostButton: '[data-testid="retweet"], [data-testid="unretweet"]',
    likeButton: '[data-testid="like"], [data-testid="unlike"]',
    /** Quoted posts render as an embedded link card inside the article. */
    quoteContainer: '[role="link"]',
    statusLink: 'a[href*="/status/"]',
  },
  profile: {
    userName: '[data-testid="UserName"]',
    description: '[data-testid="UserDescription"]',
    location: '[data-testid="UserLocation"]',
    website: '[data-testid="UserUrl"]',
    joinDate: '[data-testid="UserJoinDate"]',
    followingLink: 'a[href$="/following"]',
    followersLink: 'a[href$="/verified_followers"], a[href$="/followers"]',
  },
  /** URL path fragments that indicate X wants human attention. */
  checkpointPaths: ['/account/access', '/i/flow/login'],
} as const;
