import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "../types.js";

export interface SteamLink {
  steamId64: string;
  label?: string;
  primary: boolean;
  linkedAt: string;
}

interface UserLinks {
  accounts: SteamLink[];
}

interface Data {
  version: 1;
  links: Record<string, UserLinks>;
}

export interface LinkStoreOptions {
  filePath: string;
}

function emptyData(): Data {
  return { version: 1, links: {} };
}

/**
 * Discord user → many Steam accounts. Each SteamID64 is unique across the store
 * (one Discord owner) to prevent claim fights.
 */
export class LinkStore {
  private data: Data = emptyData();
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly opts: LinkStoreOptions) {}

  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await readFile(this.opts.filePath, "utf8");
    } catch (err) {
      if ((asErrno(err)).code !== "ENOENT") throw err;
    }
    if (raw === null) {
      this.data = emptyData();
      return;
    }
    let parsed: Partial<Data>;
    try {
      parsed = JSON.parse(raw) as Partial<Data>;
    } catch {
      throw new Error(
        `CS links file ${this.opts.filePath} is not valid JSON. Fix or move it; refusing to start with empty links.`,
      );
    }
    const data = emptyData();
    for (const [discordId, u] of Object.entries(parsed.links ?? {})) {
      if (!u || !Array.isArray(u.accounts)) continue;
      const accounts: SteamLink[] = [];
      for (const a of u.accounts) {
        if (!a || typeof a.steamId64 !== "string") continue;
        accounts.push({
          steamId64: a.steamId64,
          label: typeof a.label === "string" && a.label.trim() ? a.label.trim() : undefined,
          primary: Boolean(a.primary),
          linkedAt: typeof a.linkedAt === "string" ? a.linkedAt : new Date().toISOString(),
        });
      }
      if (accounts.length === 0) continue;
      // Ensure exactly one primary when any accounts exist
      if (!accounts.some((a) => a.primary)) accounts[0]!.primary = true;
      let seenPrimary = false;
      for (const a of accounts) {
        if (a.primary) {
          if (seenPrimary) a.primary = false;
          else seenPrimary = true;
        }
      }
      data.links[discordId] = { accounts };
    }
    this.data = data;
  }

  list(discordUserId: string): SteamLink[] {
    return [...(this.data.links[discordUserId]?.accounts ?? [])];
  }

  primary(discordUserId: string): SteamLink | null {
    const accounts = this.data.links[discordUserId]?.accounts ?? [];
    return accounts.find((a) => a.primary) ?? accounts[0] ?? null;
  }

  /** Who currently owns this SteamID64, if anyone. */
  ownerOf(steamId64: string): string | null {
    for (const [discordId, u] of Object.entries(this.data.links)) {
      if (u.accounts.some((a) => a.steamId64 === steamId64)) return discordId;
    }
    return null;
  }

  link(
    discordUserId: string,
    steamId64: string,
    opts: { label?: string; primary?: boolean } = {},
  ): SteamLink {
    const existingOwner = this.ownerOf(steamId64);
    if (existingOwner && existingOwner !== discordUserId) {
      throw new UserError(`Steam account ${steamId64} is already linked to another Discord user.`);
    }

    let user = this.data.links[discordUserId];
    if (!user) {
      user = { accounts: [] };
      this.data.links[discordUserId] = user;
    }

    const already = user.accounts.find((a) => a.steamId64 === steamId64);
    if (already) {
      if (opts.label !== undefined) already.label = opts.label.trim() || undefined;
      if (opts.primary) this.setPrimary(discordUserId, steamId64);
      this.markDirty();
      return already;
    }

    const makePrimary = opts.primary === true || user.accounts.length === 0;
    if (makePrimary) {
      for (const a of user.accounts) a.primary = false;
    }
    const entry: SteamLink = {
      steamId64,
      label: opts.label?.trim() || undefined,
      primary: makePrimary,
      linkedAt: new Date().toISOString(),
    };
    user.accounts.push(entry);
    this.markDirty();
    return entry;
  }

  unlink(discordUserId: string, steamId64OrLabel: string): SteamLink {
    const user = this.data.links[discordUserId];
    if (!user || user.accounts.length === 0) {
      throw new UserError("You have no linked Steam accounts.");
    }
    const idx = user.accounts.findIndex(
      (a) => a.steamId64 === steamId64OrLabel || a.label === steamId64OrLabel,
    );
    if (idx < 0) throw new UserError(`No linked Steam account matching "${steamId64OrLabel}".`);
    const [removed] = user.accounts.splice(idx, 1);
    if (user.accounts.length === 0) {
      delete this.data.links[discordUserId];
    } else if (removed!.primary) {
      user.accounts[0]!.primary = true;
    }
    this.markDirty();
    return removed!;
  }

  /** Force-unlink regardless of owner (owner/admin tool path). */
  forceUnlink(steamId64: string): { discordUserId: string; link: SteamLink } | null {
    const owner = this.ownerOf(steamId64);
    if (!owner) return null;
    const link = this.unlink(owner, steamId64);
    return { discordUserId: owner, link };
  }

  setPrimary(discordUserId: string, steamId64OrLabel: string): SteamLink {
    const user = this.data.links[discordUserId];
    if (!user) throw new UserError("You have no linked Steam accounts.");
    const target = user.accounts.find(
      (a) => a.steamId64 === steamId64OrLabel || a.label === steamId64OrLabel,
    );
    if (!target) throw new UserError(`No linked Steam account matching "${steamId64OrLabel}".`);
    for (const a of user.accounts) a.primary = a === target;
    this.markDirty();
    return target;
  }

  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writing = this.writing
      .then(async () => {
        if (!this.dirty) return;
        this.dirty = false;
        const json = JSON.stringify(this.data, null, 0);
        await mkdir(path.dirname(this.opts.filePath), { recursive: true });
        const tmp = `${this.opts.filePath}.tmp`;
        await writeFile(tmp, json, "utf8");
        await rename(tmp, this.opts.filePath);
      })
      .catch((err) => {
        this.dirty = true;
        console.error("[cs-tracker] save failed:", err);
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
}

function asErrno(err: unknown): NodeJS.ErrnoException {
  return err as NodeJS.ErrnoException;
}
