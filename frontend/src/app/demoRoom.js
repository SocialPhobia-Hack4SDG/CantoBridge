import { createStore, createMemoryStorage } from './store.js';
import { createMockApi } from '../services/mockApi.js';

/** Explicit preview only: all room writes live in an isolated memory store. */
export function createDemoRoom(source, { now = () => Date.now() } = {}) {
  const store = createStore({ storage: createMemoryStorage(), now });
  store.hydrate({ learnerProfile: source.learnerProfile, buddyProfile: source.buddyProfile, settings: source.settings });
  store.setRole(source.role);
  store.setLocale(source.locale);
  store.saveSettings({ signalMode: 'sim', mockDelayMs: 0, anonymous: false, visibility: { interests: true, level: true, identity: true } });
  const peer = { peerId: 'demo-partner', displayName: 'Canto · Demo', avatarId: 'star', frameId: 'orbit', anonymous: false, nativeLanguage: source.role === 'buddy' ? 'mandarin' : 'yue', cantoneseLevel: 'beginner', identity: 'university_student', interests: ['anime', 'food', 'travel', 'movies'], role: source.role === 'buddy' ? 'learner' : 'buddy' };
  store.startRoom({ roomId: 'demo-preview', peer, role: source.role });
  return { store, api: createMockApi({ store }), rooms: new Map() };
}
