/**
 * 路由表（唯一真源在 docs/03-ia-and-pages.md，tools/check-ui.mjs 会校验两边一致）。
 * guard 语义：
 *   'onboarded' 需要当前身份已完成 onboarding，否则回 /onboarding/role
 *   'buddy'     仅粤语母语者，学习者误入回 /match
 *   'room'      内存里必须有这个房间，否则提示后回 /match（刷新丢房的兜底）
 */

import { LandingPage } from '../pages/landing.js';
import { RegisterPage } from '../pages/register.js';
import { RoleSelectPage, ProfileSetupPage, PrivacySetupPage } from '../pages/onboarding.js';
import { HomePage } from '../pages/home.js';
import { MatchPage, PeerPreviewPage } from '../pages/match.js';
import { ChatRoomPage, SessionSummaryPage } from '../pages/room.js';
import { ProfilePage } from '../pages/me.js';
import { ShopPage } from '../pages/shop.js';
import { LeaderboardPage } from '../pages/leaderboard.js';
import { HistoryPage } from '../pages/history.js';
import { MockConsolePage } from '../pages/dev.js';
import { NotFoundPage } from '../pages/notFound.js';

export const ROUTES = [
  { path: '/', name: 'landing', page: LandingPage, titleKey: 'nav.home', guard: null, nav: null, back: false, immersive: true },
  // 注册页：账号是**点这一下**才长出来的（见 pages/register.js）。它不属于 onboarding 三步，
  // 所以没有 step / StepProgress——身份是注册之后才选的第一题。
  { path: '/register', name: 'register', page: RegisterPage, titleKey: 'register.title', guard: null, nav: null, back: true, immersive: false },
  { path: '/onboarding/role', name: 'role', page: RoleSelectPage, titleKey: 'role.title', guard: null, nav: null, back: true, immersive: false, step: 1, stepKey: 'role.step' },
  { path: '/onboarding/profile', name: 'profile', page: ProfileSetupPage, titleKey: 'setup.title', guard: null, nav: null, back: true, immersive: false, step: 2, stepKey: 'setup.step' },
  { path: '/onboarding/privacy', name: 'privacy', page: PrivacySetupPage, titleKey: 'privacy.title', guard: null, nav: null, back: true, immersive: false, step: 3, stepKey: 'privacy.step' },
  { path: '/home', name: 'home', page: HomePage, titleKey: 'app.name', guard: 'onboarded', nav: 'home', back: false, immersive: false },
  { path: '/match', name: 'match', page: MatchPage, titleKey: 'match.title', guard: 'onboarded', nav: 'match', back: false, immersive: false },
  { path: '/match/:learnerId', name: 'peerPreview', page: PeerPreviewPage, titleKey: 'preview.title', guard: 'buddy', nav: null, back: true, immersive: false },
  { path: '/room/:roomId', name: 'room', page: ChatRoomPage, titleKey: 'room.title', guard: 'room', nav: null, back: false, immersive: true },
  { path: '/room/:roomId/summary', name: 'summary', page: SessionSummaryPage, titleKey: 'summary.title', guard: 'room', nav: null, back: false, immersive: false },
  { path: '/me', name: 'me', page: ProfilePage, titleKey: 'me.title', guard: 'onboarded', nav: 'me', back: false, immersive: false },
  { path: '/leaderboard', name: 'leaderboard', page: LeaderboardPage, titleKey: 'leaderboard.title', guard: 'onboarded', nav: 'leaderboard', back: false, immersive: false },
  { path: '/shop', name: 'shop', page: ShopPage, titleKey: 'shop.title', guard: 'onboarded', nav: null, back: true, immersive: false, backLabelKey: 'action.back', backTo: '/me' },
  { path: '/history', name: 'history', page: HistoryPage, titleKey: 'history.title', guard: 'onboarded', nav: null, back: true, immersive: false, backLabelKey: 'action.back', backTo: '/me' },
  { path: '/dev/mock', name: 'devMock', page: MockConsolePage, titleKey: 'dev.title', guard: null, nav: null, back: true, immersive: false },
  { path: '*', name: 'notFound', page: NotFoundPage, titleKey: 'notFound.title', guard: null, nav: null, back: false, immersive: false },
];

export const ROUTE_PATHS = ROUTES.map((route) => route.path);

export function findRoute(path) {
  return ROUTES.find((route) => route.path === path) ?? ROUTES[ROUTES.length - 1];
}
