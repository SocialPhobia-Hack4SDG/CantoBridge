import { createStore, createMemoryStorage } from './store.js';
import { createMockApi } from '../services/mockApi.js';
import { createTranslator } from '../i18n/i18n.js';

export function demoPeer(source) {
  const learner = source.role === 'buddy';
  const t = createTranslator(source.locale);
  return { peerId: learner ? 'demo-learner' : 'demo-canto-buddy', displayName: t(learner ? 'demo.learnerName' : 'demo.buddyName'), avatarId: 'star', frameId: 'orbit', anonymous: false, nativeLanguage: learner ? 'mandarin' : 'yue', cantoneseLevel: learner ? 'beginner' : 'advanced', identity: 'university_student', interests: ['anime', 'food', 'travel', 'movies'], role: learner ? 'learner' : 'buddy' };
}

/** All demo room writes live in an isolated memory store. */
export function createDemoRoom(source, { now = () => Date.now() } = {}) {
  const store = createStore({ storage: createMemoryStorage(), now });
  store.hydrate({ learnerProfile: source.learnerProfile, buddyProfile: source.buddyProfile, settings: source.settings });
  store.setRole(source.role);
  store.setLocale(source.locale);
  store.saveSettings({ signalMode: 'sim', mockDelayMs: 0, anonymous: false, visibility: { interests: true, level: true, identity: true } });
  const peer = demoPeer(source);
  store.startRoom({ roomId: 'demo-preview', peer, role: source.role });
  return { store, api: createMockApi({ store }), rooms: new Map() };
}
