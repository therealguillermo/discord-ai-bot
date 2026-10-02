import { randomInt } from "node:crypto";

export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  rank: Rank;
  suit: Suit;
}

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

/** Fisher-Yates using a cryptographically secure RNG. Returns a new array. */
export function shuffle<T>(items: readonly T[], rand: (maxExclusive: number) => number = (n) => randomInt(n)): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function cardValue(card: Card): number {
  if (card.rank === "A") return 11;
  if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
  return Number(card.rank);
}

/**
 * Best total for a hand. Aces count as 11 and are downgraded to 1 one at a time as needed,
 * so soft hands (e.g. A+5) are handled correctly no matter when the ace arrived.
 */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export type Outcome = "blackjack" | "win" | "push" | "lose" | "bust" | "dealer-blackjack";

/**
 * One hand of blackjack: single deck, dealer stands on all 17s, blackjack pays 3:2,
 * double down on the first two cards. Pure logic - no Discord, no money.
 *
 * `stake` is the current total wagered (it doubles after a double down).
 */
export class BlackjackGame {
  readonly player: Card[] = [];
  readonly dealer: Card[] = [];
  stake: number;
  doubled = false;
  finished = false;
  outcome?: Outcome;
  private readonly deck: Card[];

  constructor(stake: number, deck: Card[] = shuffle(createDeck())) {
    this.stake = stake;
    this.deck = deck;
    // Deal alternately: player, dealer, player, dealer. Cards are drawn from the end of `deck`.
    this.player.push(this.draw());
    this.dealer.push(this.draw());
    this.player.push(this.draw());
    this.dealer.push(this.draw());

    // Naturals are resolved immediately.
    const playerBJ = isBlackjack(this.player);
    const dealerBJ = isBlackjack(this.dealer);
    if (playerBJ && dealerBJ) this.finish("push");
    else if (playerBJ) this.finish("blackjack");
    else if (dealerBJ) this.finish("dealer-blackjack");
  }

  get playerTotal(): number {
    return handValue(this.player).total;
  }

  get dealerTotal(): number {
    return handValue(this.dealer).total;
  }

  canDouble(): boolean {
    return !this.finished && this.player.length === 2;
  }

  hit(): void {
    this.assertActive();
    this.player.push(this.draw());
    const total = this.playerTotal;
    if (total > 21) this.finish("bust");
    else if (total === 21) this.stand(); // nothing left to gain
  }

  stand(): void {
    this.assertActive();
    while (this.dealerTotal < 17) this.dealer.push(this.draw());
    const p = this.playerTotal;
    const d = this.dealerTotal;
    if (d > 21 || p > d) this.finish("win");
    else if (p < d) this.finish("lose");
    else this.finish("push");
  }

  /** Double the stake, take exactly one card, then stand. The caller must collect the extra stake first. */
  double(): void {
    if (!this.canDouble()) throw new Error("Can only double down on the first two cards.");
    this.stake *= 2;
    this.doubled = true;
    this.player.push(this.draw());
    if (this.playerTotal > 21) this.finish("bust");
    else this.stand();
  }

  /** Total coins returned to the player (stake included). 0 on a loss. */
  payout(): number {
    switch (this.outcome) {
      case "blackjack":
        return this.stake + Math.floor((this.stake * 3) / 2);
      case "win":
        return this.stake * 2;
      case "push":
        return this.stake;
      case "lose":
      case "bust":
      case "dealer-blackjack":
        return 0;
      default:
        throw new Error("Game is not finished.");
    }
  }

  /** Net coins won (positive) or lost (negative) relative to the stake. */
  net(): number {
    return this.payout() - this.stake;
  }

  private draw(): Card {
    const card = this.deck.pop();
    if (!card) throw new Error("Deck is empty.");
    return card;
  }

  private assertActive(): void {
    if (this.finished) throw new Error("Game is already finished.");
  }

  private finish(outcome: Outcome): void {
    this.finished = true;
    this.outcome = outcome;
  }
}
