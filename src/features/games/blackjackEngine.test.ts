import { describe, expect, it } from "vitest";
import { BlackjackGame, createDeck, handValue, shuffle, type Card, type Rank, type Suit } from "./blackjackEngine.js";

const c = (rank: Rank, suit: Suit = "♠"): Card => ({ rank, suit });

/**
 * Build a deck that deals the given cards in order (player, dealer, player, dealer, then extras).
 * The engine draws from the END of the array, so reverse it.
 */
const stacked = (...cards: Card[]): Card[] => [...cards].reverse();

describe("handValue", () => {
  it("counts face cards as 10 and an ace as 11 when it fits", () => {
    expect(handValue([c("K"), c("A")])).toEqual({ total: 21, soft: true });
  });

  it("downgrades an earlier ace when a later card would bust (old bot bug: A+5 then 10 was a bust)", () => {
    expect(handValue([c("A"), c("5"), c("K")]).total).toBe(16);
  });

  it("handles two aces as 12, not 22", () => {
    expect(handValue([c("A"), c("A", "♥")]).total).toBe(12);
  });

  it("downgrades aces one at a time", () => {
    expect(handValue([c("A"), c("A", "♥"), c("9")])).toEqual({ total: 21, soft: true });
    expect(handValue([c("A"), c("A", "♥"), c("9"), c("5")]).total).toBe(16);
  });

  it("reports 10 as a single card of value 10", () => {
    expect(handValue([c("10"), c("7")]).total).toBe(17);
  });
});

describe("deck", () => {
  it("has 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((x) => x.rank + x.suit)).size).toBe(52);
  });

  it("shuffle keeps every card and does not mutate the input", () => {
    const deck = createDeck();
    const copy = [...deck];
    const out = shuffle(deck);
    expect(deck).toEqual(copy);
    expect(out).toHaveLength(52);
    expect(new Set(out.map((x) => x.rank + x.suit)).size).toBe(52);
  });
});

describe("BlackjackGame", () => {
  it("pays 3:2 on a natural blackjack, resolved on the deal", () => {
    // player A,K  dealer 9,7
    const g = new BlackjackGame(100, stacked(c("A"), c("9"), c("K"), c("7")));
    expect(g.finished).toBe(true);
    expect(g.outcome).toBe("blackjack");
    expect(g.payout()).toBe(250); // stake back + 150
  });

  it("rounds 3:2 down on odd bets", () => {
    const g = new BlackjackGame(5, stacked(c("A"), c("9"), c("K"), c("7")));
    expect(g.payout()).toBe(5 + 7);
  });

  it("is a push when both have blackjack", () => {
    const g = new BlackjackGame(100, stacked(c("A"), c("A", "♥"), c("K"), c("K", "♥")));
    expect(g.outcome).toBe("push");
    expect(g.payout()).toBe(100);
  });

  it("loses immediately to a dealer blackjack", () => {
    const g = new BlackjackGame(100, stacked(c("9"), c("A"), c("8"), c("K")));
    expect(g.outcome).toBe("dealer-blackjack");
    expect(g.payout()).toBe(0);
  });

  it("player busts on a hit", () => {
    // player 10,6  dealer 9,7  next card K
    const g = new BlackjackGame(50, stacked(c("10"), c("9"), c("6"), c("7"), c("K")));
    expect(g.finished).toBe(false);
    g.hit();
    expect(g.outcome).toBe("bust");
    expect(g.payout()).toBe(0);
  });

  it("does not bust a soft hand that can downgrade its ace", () => {
    // player A,5 (soft 16)  dealer 9,7  next card K -> 16, not a bust
    const g = new BlackjackGame(50, stacked(c("A"), c("9"), c("5"), c("7"), c("K")));
    g.hit();
    expect(g.playerTotal).toBe(16);
    expect(g.finished).toBe(false);
  });

  it("auto-stands when the player reaches 21", () => {
    // player 9,2 (11) + K = 21 ; dealer 10,6 draws 5 -> 21 push
    const g = new BlackjackGame(50, stacked(c("9"), c("10"), c("2"), c("6"), c("K"), c("5")));
    g.hit();
    expect(g.finished).toBe(true);
    expect(g.playerTotal).toBe(21);
    expect(g.outcome).toBe("push");
  });

  it("dealer draws to 17 even when already ahead of the player's lower total (old bot skipped this)", () => {
    // player 10,2 (12), dealer 10,5 (15) -> dealer must draw; draws K and busts
    const g = new BlackjackGame(50, stacked(c("10"), c("10", "♥"), c("2"), c("5"), c("K")));
    g.stand();
    expect(g.dealer.length).toBe(3);
    expect(g.outcome).toBe("win");
    expect(g.payout()).toBe(100);
  });

  it("dealer stands on 17 including soft 17", () => {
    // dealer A,6 = soft 17 -> stands. player 10,8 = 18 wins
    const g = new BlackjackGame(50, stacked(c("10"), c("A"), c("8"), c("6")));
    g.stand();
    expect(g.dealer).toHaveLength(2);
    expect(g.outcome).toBe("win");
  });

  it("loses and pushes correctly on stand", () => {
    const lose = new BlackjackGame(50, stacked(c("10"), c("10", "♥"), c("7"), c("9")));
    lose.stand();
    expect(lose.outcome).toBe("lose");
    expect(lose.payout()).toBe(0);

    const push = new BlackjackGame(50, stacked(c("10"), c("10", "♥"), c("8"), c("8", "♥")));
    push.stand();
    expect(push.outcome).toBe("push");
    expect(push.payout()).toBe(50);
  });

  it("double down doubles the stake, takes exactly one card and stands", () => {
    // player 5,6 (11) +10 = 21 ; dealer 10,7 = 17 -> win at 2x stake
    const g = new BlackjackGame(50, stacked(c("5"), c("10"), c("6"), c("7"), c("10", "♥")));
    expect(g.canDouble()).toBe(true);
    g.double();
    expect(g.stake).toBe(100);
    expect(g.player).toHaveLength(3);
    expect(g.finished).toBe(true);
    expect(g.outcome).toBe("win");
    expect(g.payout()).toBe(200);
    expect(g.net()).toBe(100);
  });

  it("cannot double down after hitting", () => {
    const g = new BlackjackGame(50, stacked(c("2"), c("10"), c("3"), c("7"), c("2", "♥")));
    g.hit();
    expect(g.canDouble()).toBe(false);
    expect(() => g.double()).toThrow();
  });

  it("refuses to act after the game is over", () => {
    const g = new BlackjackGame(50, stacked(c("10"), c("10", "♥"), c("7"), c("9")));
    g.stand();
    expect(() => g.hit()).toThrow();
    expect(() => g.stand()).toThrow();
  });

  it("never loses or invents coins across many random games", () => {
    for (let i = 0; i < 500; i++) {
      const g = new BlackjackGame(10);
      while (!g.finished) {
        if (g.playerTotal < 17) g.hit();
        else g.stand();
      }
      const p = g.payout();
      expect([0, 10, 20, 25]).toContain(p);
    }
  });
});
