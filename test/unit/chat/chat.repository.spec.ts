import { sortedPair } from '@/modules/chat/chat.repository';

/**
 * The pair ordering is the whole reason one conversation cannot become two.
 *
 * If A→B and B→A sorted differently, both sides would create their own thread
 * and each would see half the messages — which is the bug account-based chat
 * exists to prevent.
 */
describe('sortedPair', () => {
  it('gives the same pair whichever way round it is asked', () => {
    expect(sortedPair('u-asha', 'u-bright')).toEqual(sortedPair('u-bright', 'u-asha'));
  });

  it('puts the lower id first', () => {
    expect(sortedPair('u-bright', 'u-asha')).toEqual(['u-asha', 'u-bright']);
  });
});
