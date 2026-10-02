import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface UserRecord {
  balance: number;
  games: number;
  /** Lifetime net winnings from games (can be negative). */
  net: number;
}

interface PendingBet {
  userId: string;
  amount: number;
  at: string;
}

interface Data {
  version: 1;
  users: Record<string, UserRecord>;
  /** Bets currently in escrow (debited from the player, not yet settled). Refunded on startup. */
  pending: Record<string, PendingBet>;
  /** Balances imported from the old bot, keyed by the old username key. Claimed on first use. */
  legacy: Record<string, number>;
}

export interface EconomyOptions {
  filePath: string;
  startingBalance: number;
}

function emptyData(): Data {
  return { version: 1, users: {}, pending: {}, legacy: {} };
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`Amount must be a positive integer, got ${amount}.`);
  }
}

function toCoins(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Coin balances persisted to a JSON file.
 *
 * All mutations are synchronous (so they are atomic in Node's single thread) and saved with a
 * write-to-temp-then-rename, so a crash can never leave a half-written file. Bets are escrowed
 * with hold()/settle(): if the process dies mid-game the bet is refunded on the next load().
 */
export class EconomyStore {
  private data: Data = emptyData();
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly opts: EconomyOptions) {}

  /** Load from disk. Refunds any escrowed bets left over from a crash. Returns how many were refunded. */
  async load(): Promise<{ refunded: number }> {
    let raw: string | null = null;
    try {
      raw = await readFile(this.opts.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    if (raw !== null) {
      let parsed: Partial<Data>;
      try {
        parsed = JSON.parse(raw) as Partial<Data>;
      } catch {
        throw new Error(
          `Economy file ${this.opts.filePath} is not valid JSON. Fix or move it; refusing to start with an empty economy.`,
        );
      }
      const data = emptyData();
      for (const [id, u] of Object.entries(parsed.users ?? {})) {
        data.users[id] = {
          balance: toCoins(u?.balance),
          games: toCoins(u?.games),
          net: Math.trunc(Number(u?.net)) || 0,
        };
      }
      for (const [id, p] of Object.entries(parsed.pending ?? {})) {
        if (p && typeof p.userId === "string") data.pending[id] = { userId: p.userId, amount: toCoins(p.amount), at: String(p.at ?? "") };
      }
      for (const [name, v] of Object.entries(parsed.legacy ?? {})) data.legacy[name] = toCoins(v);
      this.data = data;
    }

    let refunded = 0;
    for (const [id, p] of Object.entries(this.data.pending)) {
      this.user(p.userId).balance += p.amount;
      delete this.data.pending[id];
      refunded++;
    }
    if (refunded > 0) {
      this.dirty = true;
      await this.flush();
    }
    return { refunded };
  }

  /* ----------------------------- reads ----------------------------- */

  has(userId: string): boolean {
    return userId in this.data.users;
  }

  getBalance(userId: string): number {
    return this.data.users[userId]?.balance ?? 0;
  }

  leaderboard(limit: number): { userId: string; balance: number }[] {
    return Object.entries(this.data.users)
      .map(([userId, u]) => ({ userId, balance: u.balance }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

  /* ----------------------------- accounts ----------------------------- */

  /** Create the account if needed (with the starting balance). Returns true if it was just created. */
  ensure(userId: string): boolean {
    if (this.has(userId)) return false;
    this.data.users[userId] = { balance: this.opts.startingBalance, games: 0, net: 0 };
    this.markDirty();
    return true;
  }

  /** Import old-bot balances. Existing legacy entries are kept; returns how many names were added. */
  importLegacy(entries: Record<string, unknown>): number {
    let added = 0;
    for (const [name, value] of Object.entries(entries)) {
      if (name in this.data.legacy) continue;
      this.data.legacy[name] = toCoins(value);
      added++;
    }
    if (added > 0) this.markDirty();
    return added;
  }

  /** Move any legacy balance filed under one of these names into the account. Returns coins claimed. */
  claimLegacy(userId: string, names: string[]): number {
    let claimed = 0;
    let touched = false;
    for (const name of names) {
      const v = this.data.legacy[name];
      if (v === undefined) continue;
      delete this.data.legacy[name];
      claimed += v;
      touched = true;
    }
    if (claimed > 0) {
      this.ensure(userId);
      this.user(userId).balance += claimed;
    }
    if (touched) this.markDirty();
    return claimed;
  }

  /* ----------------------------- plain movements ----------------------------- */

  credit(userId: string, amount: number): void {
    assertAmount(amount);
    this.user(userId).balance += amount;
    this.markDirty();
  }

  /** Remove coins. Returns false (and changes nothing) if the user can't afford it. */
  debit(userId: string, amount: number): boolean {
    assertAmount(amount);
    const u = this.user(userId);
    if (u.balance < amount) return false;
    u.balance -= amount;
    this.markDirty();
    return true;
  }

  /* ----------------------------- escrowed bets ----------------------------- */

  /** Take a bet out of the player's balance into escrow. Returns a hold id, or null if they can't afford it. */
  hold(userId: string, amount: number): string | null {
    assertAmount(amount);
    const u = this.user(userId);
    if (u.balance < amount) return null;
    u.balance -= amount;
    const id = randomUUID();
    this.data.pending[id] = { userId, amount, at: new Date().toISOString() };
    this.markDirty();
    return id;
  }

  /** Add to an existing escrow (double down). Returns false if the player can't afford it. */
  addToHold(holdId: string, extra: number): boolean {
    assertAmount(extra);
    const p = this.data.pending[holdId];
    if (!p) throw new Error("Unknown or already settled hold.");
    const u = this.user(p.userId);
    if (u.balance < extra) return false;
    u.balance -= extra;
    p.amount += extra;
    this.markDirty();
    return true;
  }

  /** Close an escrow and pay out `payout` coins (0 for a loss). Can only be called once per hold. */
  settle(holdId: string, payout: number): { net: number; balance: number } {
    const p = this.data.pending[holdId];
    if (!p) throw new Error("Unknown or already settled hold.");
    if (!Number.isSafeInteger(payout) || payout < 0) throw new RangeError(`Invalid payout ${payout}.`);
    delete this.data.pending[holdId];
    const u = this.user(p.userId);
    u.balance += payout;
    const net = payout - p.amount;
    u.games += 1;
    u.net += net;
    this.markDirty();
    return { net, balance: u.balance };
  }

  /* ----------------------------- persistence ----------------------------- */

  /** Write to disk now (also called automatically a moment after any change). */
  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writing = this.writing
      .then(async () => {
        if (!this.dirty) return;
        this.dirty = false;
        const json = JSON.stringify(this.data);
        await mkdir(path.dirname(this.opts.filePath), { recursive: true });
        const tmp = `${this.opts.filePath}.tmp`;
        await writeFile(tmp, json, "utf8");
        await rename(tmp, this.opts.filePath);
      })
      .catch((err) => {
        this.dirty = true;
        console.error("[economy] save failed:", err);
      });
    return this.writing;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 250);
    this.saveTimer.unref?.();
  }

  private user(userId: string): UserRecord {
    let u = this.data.users[userId];
    if (!u) {
      u = { balance: this.opts.startingBalance, games: 0, net: 0 };
      this.data.users[userId] = u;
    }
    return u;
  }
}
