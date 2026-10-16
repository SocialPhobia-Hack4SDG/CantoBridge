import { pickCards, seedFrom } from '../lib/topicPicker.js';

const source = { mode: 'mock', provider: 'sample', model: null };

/** Offline sample mirrors the backend contract; no speech service or microphone. */
export function sampleTopicCards({ learnerInterests, buddyInterests, cantoneseLevel, count = 3 }) {
  const sharedInterests = learnerInterests.filter(item => buddyInterests.includes(item));
  const context = { learnerInterests, buddyInterests, cantoneseLevel, count, sharedInterests };
  return { ...source, context, cards: pickCards({ interests: sharedInterests, level: cantoneseLevel, count, seed: seedFrom(JSON.stringify(context)) }) };
}

export function sampleTutorReply({ currentCard }) {
  return { ...source, cardId: currentCard.id,
    reply: {
      cantonese: `多謝你分享！我哋可以用呢個問題繼續練習：${currentCard.cantonese}`,
      mandarin: `谢谢你的分享！我们可以用这个问题继续练习：${currentCard.mandarin}`,
      english: `Thanks for sharing! Let’s practise this question: ${currentCard.english}`,
    },
    suggestions: currentCard.expressions.slice(0, 2).map(item => ({ ...item })),
  };
}
