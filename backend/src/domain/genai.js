import { ApiError } from '../http/envelope.js';
import { requireSession } from '../http/auth.js';
import { LEVELS } from '../data/vocabularies.js';
import { createSampleGenAiProvider } from '../services/genai.js';
import { assertInt, assertKnownKeys } from './validate.js';

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('bad_request', `${field} must be an object`);
  return value;
}

function text(value, field, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError('bad_request', `${field} must be a non-empty string (<= ${max})`);
  return value.trim();
}

function level(value, field) {
  if (!LEVELS.includes(value)) throw new ApiError('bad_request', `${field} must be one of: ${LEVELS.join(', ')}`);
  return value;
}

function interests(value, field) {
  if (!Array.isArray(value) || value.length > 5) throw new ApiError('bad_request', `${field} must be an array of at most 5 interests`);
  return [...new Set(value.map(item => text(item, field, 40)))];
}

function translation(value, field, max = 500) {
  object(value, field);
  assertKnownKeys(value, { allowed: ['cantonese', 'mandarin', 'english'] }, field);
  return Object.fromEntries(['cantonese', 'mandarin', 'english'].map(key => [key, text(value[key], `${field}.${key}`, max)]));
}

function card(value, field = 'currentCard') {
  object(value, field);
  assertKnownKeys(value, { allowed: ['id', 'topic', 'difficulty', 'cantonese', 'jyutping', 'mandarin', 'english', 'expressions'] }, field);
  if (!Array.isArray(value.expressions) || value.expressions.length < 1 || value.expressions.length > 4) throw new ApiError('bad_request', `${field}.expressions must contain 1 to 4 items`);
  return {
    id: text(value.id, `${field}.id`, 100), topic: text(value.topic, `${field}.topic`, 100),
    difficulty: level(value.difficulty, `${field}.difficulty`),
    ...Object.fromEntries(['cantonese', 'jyutping', 'mandarin', 'english'].map(key => [key, text(value[key], `${field}.${key}`)])),
    expressions: value.expressions.map(item => translation(item, `${field}.expressions`)),
  };
}

/** Provider injection is the only integration point; the default never uses the network. */
export function createGenAiHandlers({ db, provider = createSampleGenAiProvider() }) {
  const metadata = { mode: provider.mode, provider: provider.name, model: provider.model };
  async function invoke(method, input, validate) {
    try { return validate(await provider[method](input)); }
    catch { throw new ApiError('internal', 'GenAI provider failed or returned an invalid response'); }
  }
  function request(req, body, allowed) {
    requireSession(req, db);
    assertKnownKeys(body, { allowed: [...allowed, 'requestId'] }, 'GenAI');
    if (body.requestId !== undefined) text(body.requestId, 'requestId', 128);
  }
  return {
    async generateCards({ req, body }) {
      request(req, body, ['learnerInterests', 'buddyInterests', 'cantoneseLevel', 'count']);
      const input = {
        learnerInterests: interests(body.learnerInterests, 'learnerInterests'),
        buddyInterests: interests(body.buddyInterests, 'buddyInterests'),
        cantoneseLevel: level(body.cantoneseLevel, 'cantoneseLevel'),
        count: assertInt(body.count, 'count', { min: 1, max: 8, defaultValue: 3 }),
      };
      const sharedInterests = input.learnerInterests.filter(item => input.buddyInterests.includes(item));
      const result = await invoke('generateCards', { ...input, sharedInterests }, output => {
        if (!Array.isArray(output?.cards) || output.cards.length !== input.count) throw Error('invalid card count');
        const cards = output.cards.map(item => card(item, 'cards'));
        if (new Set(cards.map(item => item.id)).size !== cards.length) throw Error('duplicate cards');
        return { cards };
      });
      return { data: { ...metadata, ...result, context: { ...input, sharedInterests } } };
    },
    async tutorReply({ req, body }) {
      request(req, body, ['text', 'currentCard']);
      const input = { text: text(body.text, 'text', 2000), currentCard: card(body.currentCard) };
      const result = await invoke('tutorReply', input, output => {
        if (!Array.isArray(output?.suggestions) || output.suggestions.length < 1 || output.suggestions.length > 3) throw Error('invalid suggestions');
        return { reply: translation(output.reply, 'reply', 1000), suggestions: output.suggestions.map(item => translation(item, 'suggestions')) };
      });
      return { data: { ...metadata, ...result, cardId: input.currentCard.id } };
    },
  };
}
