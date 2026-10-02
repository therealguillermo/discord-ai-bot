import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type Message,
  type User,
} from "discord.js";
import { economy, formatCoins, touch } from "../economy/instance.js";
import { UserError, type PrefixCommand } from "../types.js";
import { parseBet } from "./bet.js";
import { BlackjackGame, handValue, type Card, type Outcome } from "./blackjackEngine.js";

/** Users with a hand in progress (one at a time). */
const activeGames = new Set<string>();

const IDLE_MS = 60_000;
const MAX_GAME_MS = 15 * 60_000;
const AGAIN_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

const RESULT_TEXT: Record<Outcome, (net: number) => string> = {
  blackjack: (n) => `**Blackjack!** You won ${formatCoins(n)} coins.`,
  win: (n) => `**You win!** +${formatCoins(n)} coins.`,
  push: () => "**Push.** Your bet is returned.",
  lose: (n) => `**You lose.** -${formatCoins(-n)} coins.`,
  bust: (n) => `**Bust!** -${formatCoins(-n)} coins.`,
  "dealer-blackjack": (n) => `**Dealer has blackjack.** -${formatCoins(-n)} coins.`,
};

const RESULT_COLOR: Record<Outcome, number> = {
  blackjack: 0xf1c40f,
  win: 0x2ecc71,
  push: 0x95a5a6,
  lose: 0xe74c3c,
  bust: 0xe74c3c,
  "dealer-blackjack": 0xe74c3c,
};

const PLAYING_COLOR = 0x1e7a4c;

const cardsText = (cards: readonly Card[]) => cards.map((c) => `\`${c.rank}${c.suit}\``).join(" ");

/** What we send to Discord for one render of the table. */
export interface TableMessage {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** How a hand posts its table: a prefix-command reply, or a plain channel send. */
export type TableSender = (message: TableMessage) => Promise<Message>;

type Renderer = (game: BlackjackGame) => Promise<Buffer>;
let renderer: Renderer | null | undefined;

/** The canvas renderer is a native module; if it can't load, fall back to a text-only table. */
async function getRenderer(): Promise<Renderer | null> {
  if (renderer !== undefined) return renderer;
  try {
    renderer = (await import("./blackjackTable.js")).renderBlackjackTable;
  } catch (err) {
    console.error("[blackjack] image renderer unavailable, using text tables:", err);
    renderer = null;
  }
  return renderer;
}

let frame = 0;

async function buildEmbed(
  game: BlackjackGame,
  user: User,
  opts: { balance?: number; note?: string } = {},
): Promise<{ embed: EmbedBuilder; files: AttachmentBuilder[] }> {
  const embed = new EmbedBuilder()
    .setAuthor({ name: `${user.displayName}'s blackjack`, iconURL: user.displayAvatarURL({ size: 64 }) })
    .setColor(game.finished && game.outcome ? RESULT_COLOR[game.outcome] : PLAYING_COLOR);

  const me = handValue(game.player);
  const youText = `${me.soft && me.total < 21 ? "soft " : ""}${game.playerTotal}`;
  const dealerText = game.finished
    ? String(game.dealerTotal)
    : `${game.dealer[0].rank}${game.dealer[0].suit} + ?`;

  let description: string;
  if (game.finished && game.outcome) {
    description = RESULT_TEXT[game.outcome](game.net());
    if (game.doubled) description += " *(doubled down)*";
    if (opts.balance !== undefined) description += `\nBalance: **${formatCoins(opts.balance)}**`;
  } else {
    description = `**Your move.** Hit, stand or double down.\nYou **${youText}** \u00b7 Dealer **${dealerText}**`;
  }
  embed.setDescription(description);
  if (opts.note) embed.setFooter({ text: opts.note });

  const render = await getRenderer();
  if (render) {
    try {
      const name = `blackjack-${++frame}.png`;
      const png = await render(game);
      embed.setImage(`attachment://${name}`);
      return { embed, files: [new AttachmentBuilder(png, { name })] };
    } catch (err) {
      console.error("[blackjack] render failed, using text table:", err);
    }
  }

  embed.addFields(
    { name: `You - ${game.playerTotal}`, value: cardsText(game.player), inline: false },
    {
      name: `Dealer - ${game.finished ? game.dealerTotal : "?"}`,
      value: game.finished ? cardsText(game.dealer) : `\`${game.dealer[0].rank}${game.dealer[0].suit}\` \`??\``,
      inline: false,
    },
  );
  return { embed, files: [] };
}

function playButtons(game: BlackjackGame, playerId: string): ActionRowBuilder<ButtonBuilder> {
  const canDouble = game.canDouble() && economy.getBalance(playerId) >= game.stake;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("bj:hit").setEmoji("\u{1F0CF}").setLabel("Hit").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("bj:stand").setEmoji("\u270B").setLabel("Stand").setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("bj:double")
      .setEmoji("\u23EB")
      .setLabel("Double down")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canDouble),
  );
}

function againButtons(bet: number, balance: number): ActionRowBuilder<ButtonBuilder>[] {
  if (balance < 1) return [];
  const label = bet <= balance ? `Deal again (${formatCoins(bet)})` : `Deal again (all-in ${formatCoins(balance)})`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("bj:again").setEmoji("\u{1F501}").setLabel(label).setStyle(ButtonStyle.Primary),
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* The game                                                                   */
/* -------------------------------------------------------------------------- */

export interface BlackjackStart {
  bet: number;
  /** True if the hand was decided on the deal (a natural blackjack). */
  finished: boolean;
  outcome?: Outcome;
  net?: number;
  balance?: number;
}

/**
 * Deal a hand for `user`. Throws UserError for anything the player should be told (bad bet,
 * not enough coins, hand already running). Shared by the `?blackjack` command and the agent tool.
 */
export async function startBlackjack(params: {
  user: User;
  betArg: string | undefined;
  send: TableSender;
}): Promise<BlackjackStart> {
  const { user, send } = params;
  if (activeGames.has(user.id)) throw new UserError("You already have a blackjack hand in progress - finish it first.");

  const { balance } = touch(user);
  const bet = parseBet(params.betArg, balance);
  if (!bet.ok) throw new UserError(bet.error);

  const holdId = economy.hold(user.id, bet.amount);
  if (!holdId) throw new UserError(`You only have ${formatCoins(economy.getBalance(user.id))} coins.`);
  activeGames.add(user.id);

  let settled = false;
  /** Close the escrow exactly once and return the new balance. */
  const settle = (game: BlackjackGame): number => {
    if (settled) return economy.getBalance(user.id);
    settled = true;
    activeGames.delete(user.id);
    return economy.settle(holdId, game.payout()).balance;
  };

  const game = new BlackjackGame(bet.amount);

  // Natural blackjack (either side): resolved on the deal.
  if (game.finished) {
    const newBalance = settle(game);
    try {
      const { embed, files } = await buildEmbed(game, user, { balance: newBalance });
      const msg = await send({ embeds: [embed], files, components: againButtons(bet.amount, newBalance) });
      offerAgain(msg, user, bet.amount, send);
    } catch (err) {
      console.error("[blackjack] couldn't show the finished deal (already settled):", err);
    }
    return { bet: bet.amount, finished: true, outcome: game.outcome, net: game.net(), balance: newBalance };
  }

  let msg: Message;
  try {
    const { embed, files } = await buildEmbed(game, user, { balance: economy.getBalance(user.id) });
    msg = await send({ embeds: [embed], files, components: [playButtons(game, user.id)] });
  } catch (err) {
    // Couldn't show the table: give the bet back.
    settled = true;
    activeGames.delete(user.id);
    economy.settle(holdId, bet.amount);
    throw err;
  }

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: IDLE_MS,
    time: MAX_GAME_MS,
  });

  /** Show the finished hand and offer a rematch. `edit` is the interaction update or the message edit. */
  const finishHand = async (
    edit: (m: TableMessage & { attachments: [] }) => Promise<unknown>,
    note?: string,
  ): Promise<void> => {
    const newBalance = settle(game);
    const { embed, files } = await buildEmbed(game, user, { balance: newBalance, note });
    await edit({ embeds: [embed], files, attachments: [], components: againButtons(bet.amount, newBalance) });
    offerAgain(msg, user, bet.amount, send);
  };

  let busy = false;
  collector.on("collect", async (i: ButtonInteraction) => {
    if (i.user.id !== user.id) {
      await i.reply({ content: "This isn't your hand.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    if (busy || game.finished) {
      await i.deferUpdate().catch(() => undefined);
      return;
    }
    busy = true;
    try {
      const action = i.customId.split(":")[1];
      if (action === "hit") {
        game.hit();
      } else if (action === "stand") {
        game.stand();
      } else if (action === "double") {
        // Collect the extra stake first; only then change the game.
        if (!game.canDouble() || !economy.addToHold(holdId, game.stake)) {
          await i.reply({ content: "You can't double down right now.", flags: MessageFlags.Ephemeral });
          return;
        }
        game.double();
      }

      if (game.finished) {
        collector.stop("done");
        await finishHand((m) => i.update(m));
      } else {
        const { embed, files } = await buildEmbed(game, user, { balance: economy.getBalance(user.id) });
        await i.update({ embeds: [embed], files, attachments: [], components: [playButtons(game, user.id)] });
      }
    } catch (err) {
      console.error("[blackjack] interaction failed:", err);
    } finally {
      busy = false;
    }
  });

  collector.on("end", async () => {
    if (game.finished) return; // already settled by a button press
    // Player walked away: stand on the current hand so nothing is lost or stuck in escrow.
    try {
      game.stand();
      await finishHand((m) => msg.edit(m), "Auto-stood: no response.");
    } catch (err) {
      console.error("[blackjack] timeout settle failed:", err);
      // Make sure the escrow is closed even if the message edit failed.
      try {
        if (!game.finished) game.stand();
        settle(game);
      } catch {
        /* nothing more we can do */
      }
    }
  });

  return { bet: bet.amount, finished: false };
}

/** After a hand ends, let the player rematch for the same bet with one click. */
function offerAgain(msg: Message, user: User, bet: number, send: TableSender): void {
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: AGAIN_MS,
    filter: (i) => i.customId === "bj:again",
  });
  collector.on("collect", async (i: ButtonInteraction) => {
    if (i.user.id !== user.id) {
      await i.reply({ content: "This isn't your hand.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
    collector.stop("used");
    try {
      await i.update({ components: [] });
      await startBlackjack({ user, betArg: String(bet), send });
    } catch (err) {
      const text = err instanceof UserError ? err.message : "Couldn't start a new hand.";
      if (!(err instanceof UserError)) console.error("[blackjack] rematch failed:", err);
      await i.followUp({ content: text, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  });
  collector.on("end", async (_c, reason) => {
    if (reason === "used") return;
    await msg.edit({ components: [] }).catch(() => undefined);
  });
}

/* -------------------------------------------------------------------------- */
/* ?blackjack                                                                 */
/* -------------------------------------------------------------------------- */

export const blackjack: PrefixCommand = {
  name: "blackjack",
  aliases: ["bj"],
  usage: "<bet|half|all>",
  description: "Play a hand of blackjack (blackjack pays 3:2, dealer stands on 17).",
  execute: async (ctx) => {
    await startBlackjack({
      user: ctx.message.author,
      betArg: ctx.args[0],
      send: (m) => ctx.reply(m),
    });
  },
};
