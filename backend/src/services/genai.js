import { pickCards, seedFrom } from '../lib/topics.js';

/** Contract examples only: no LLM, speech recognition, credentials or external requests. */
export function createSampleGenAiProvider() {
  return {
    name: 'sample', mode: 'mock', model: null,
    async generateCards(input) {
      // Known shared interests use the existing curated pool. Unknown/custom interests
      // remain in context; sample mode does not pretend to generate new topic content.
      return { cards: pickCards({ interests: input.sharedInterests, level: input.cantoneseLevel,
        count: input.count, seed: seedFrom(JSON.stringify(input)) }) };
    },
    async tutorReply({ currentCard }) {
      return {
        reply: {
          cantonese: `多謝你分享！我哋可以用呢個問題繼續練習：${currentCard.cantonese}`,
          mandarin: `谢谢你的分享！我们可以用这个问题继续练习：${currentCard.mandarin}`,
          english: `Thanks for sharing! Let’s practise this question: ${currentCard.english}`,
        },
        // Practice examples, not an assessment or correction of the learner's text.
        suggestions: currentCard.expressions.slice(0, 2).map(item => ({ ...item })),
      };
    },
  };
}
