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
  /** URL path fragments that indicate X wants human attention. */
  checkpointPaths: ['/account/access', '/i/flow/login'],
} as const;
