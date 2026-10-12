import { createSeed } from '../../backend/src/store/seed.js';

export function memoryStorage() {
  let saved = createSeed();
  let revision = 0;
  return {
    fail: false,
    async load() { return { data: structuredClone(saved), revision }; },
    async save(data, expected) {
      if (this.fail || revision !== expected) throw Error('storage unavailable');
      saved = structuredClone(data); return ++revision;
    },
  };
}
