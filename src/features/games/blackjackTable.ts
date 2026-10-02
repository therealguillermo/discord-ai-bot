import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { handValue, isBlackjack, type BlackjackGame, type Card, type Outcome, type Suit } from "./blackjackEngine.js";

/**
 * Draws a blackjack table (felt, chips, real-looking playing cards) as a PNG.
 * Pure drawing: it only reads the game state. No fonts are needed for the suits (they are drawn as paths).
 */

const W = 800;
const H = 620;
const CARD_W = 124;
const CARD_H = 174;
const FONT = "Arial, Helvetica, sans-serif";

const RED = "#c62828";
const BLACK = "#1a1a1d";
const GOLD = "#e3b74a";

/* ------------------------------ primitives ------------------------------ */

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const suitColor = (suit: Suit) => (suit === "♥" || suit === "♦" ? RED : BLACK);

function heartPath(ctx: SKRSContext2D): void {
  ctx.moveTo(0, -0.38);
  ctx.bezierCurveTo(0, -0.95, -1, -0.95, -1, -0.32);
  ctx.bezierCurveTo(-1, 0.18, -0.3, 0.55, 0, 0.95);
  ctx.bezierCurveTo(0.3, 0.55, 1, 0.18, 1, -0.32);
  ctx.bezierCurveTo(1, -0.95, 0, -0.95, 0, -0.38);
}

function stemPath(ctx: SKRSContext2D): void {
  ctx.moveTo(0, 0.1);
  ctx.quadraticCurveTo(0.02, 0.7, -0.38, 0.98);
  ctx.lineTo(0.38, 0.98);
  ctx.quadraticCurveTo(-0.02, 0.7, 0, 0.1);
}

/** Draw a suit symbol centred on (cx, cy) with "radius" r. `flip` rotates it 180 degrees. */
function drawSuit(ctx: SKRSContext2D, suit: Suit, cx: number, cy: number, r: number, flip = false): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, r);
  if (flip) ctx.rotate(Math.PI);
  ctx.fillStyle = suitColor(suit);
  ctx.beginPath();
  switch (suit) {
    case "♥":
      heartPath(ctx);
      break;
    case "♦":
      ctx.moveTo(0, -1);
      ctx.quadraticCurveTo(0.2, -0.35, 0.75, 0);
      ctx.quadraticCurveTo(0.2, 0.35, 0, 1);
      ctx.quadraticCurveTo(-0.2, 0.35, -0.75, 0);
      ctx.quadraticCurveTo(-0.2, -0.35, 0, -1);
      break;
    case "♠":
      ctx.save();
      ctx.scale(1, -1);
      ctx.translate(0, -0.1);
      heartPath(ctx);
      ctx.restore();
      stemPath(ctx);
      break;
    case "♣":
      ctx.arc(0, -0.45, 0.42, 0, Math.PI * 2);
      ctx.moveTo(-0.1, 0.2);
      ctx.arc(-0.5, 0.2, 0.42, 0, Math.PI * 2);
      ctx.moveTo(0.92, 0.2);
      ctx.arc(0.5, 0.2, 0.42, 0, Math.PI * 2);
      ctx.moveTo(0.35, 0);
      ctx.arc(0, 0.05, 0.36, 0, Math.PI * 2);
      stemPath(ctx);
      break;
  }
  ctx.fill();
  ctx.restore();
}

/* -------------------------------- cards -------------------------------- */

/** Pip positions as [column 0-2, row 0-1] on the card face. */
const PIPS: Record<string, [number, number][]> = {
  "2": [[1, 0], [1, 1]],
  "3": [[1, 0], [1, 0.5], [1, 1]],
  "4": [[0, 0], [2, 0], [0, 1], [2, 1]],
  "5": [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
  "6": [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  "7": [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  "8": [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
  "9": [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
  "10": [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]],
};

function drawCornerIndex(ctx: SKRSContext2D, card: Card): void {
  ctx.fillStyle = suitColor(card.suit);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold ${card.rank === "10" ? 28 : 32}px ${FONT}`;
  ctx.fillText(card.rank, 23, 38);
  drawSuit(ctx, card.suit, 23, 58, 10);
}

function drawFaceCard(ctx: SKRSContext2D, x: number, y: number, card: Card): void {
  const color = suitColor(card.suit);
  const fx = x + 34;
  const fy = y + 28;
  const fw = CARD_W - 68;
  const fh = CARD_H - 56;

  const grad = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
  grad.addColorStop(0, card.suit === "♥" || card.suit === "♦" ? "#fdecec" : "#ececf3");
  grad.addColorStop(1, card.suit === "♥" || card.suit === "♦" ? "#f8d4d4" : "#d6d6e3");
  roundRect(ctx, fx, fy, fw, fh, 8);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold 58px Georgia, "Times New Roman", serif`;
  ctx.fillText(card.rank, x + CARD_W / 2, y + CARD_H / 2 + 2);
  drawSuit(ctx, card.suit, fx + 13, fy + 15, 8);
  drawSuit(ctx, card.suit, fx + fw - 13, fy + fh - 15, 8, true);
}

function drawFaceUp(ctx: SKRSContext2D, x: number, y: number, card: Card): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  roundRect(ctx, x, y, CARD_W, CARD_H, 13);
  const grad = ctx.createLinearGradient(x, y, x, y + CARD_H);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#ecebe4");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, x, y, CARD_W, CARD_H, 13);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.stroke();

  // Corner indices (top-left, and the same rotated 180 degrees at bottom-right).
  ctx.save();
  ctx.translate(x, y);
  drawCornerIndex(ctx, card);
  ctx.restore();
  ctx.save();
  ctx.translate(x + CARD_W, y + CARD_H);
  ctx.rotate(Math.PI);
  drawCornerIndex(ctx, card);
  ctx.restore();

  if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
    drawFaceCard(ctx, x, y, card);
  } else if (card.rank === "A") {
    drawSuit(ctx, card.suit, x + CARD_W / 2, y + CARD_H / 2, 34);
  } else {
    const left = x + 42;
    const right = x + CARD_W - 42;
    const top = y + 34;
    const bottom = y + CARD_H - 34;
    for (const [col, row] of PIPS[card.rank] ?? []) {
      const px = col === 0 ? left : col === 2 ? right : x + CARD_W / 2;
      const py = top + (bottom - top) * row;
      drawSuit(ctx, card.suit, px, py, 12, row > 0.5);
    }
  }
}

function drawFaceDown(ctx: SKRSContext2D, x: number, y: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  roundRect(ctx, x, y, CARD_W, CARD_H, 13);
  ctx.fillStyle = "#f8f8f8";
  ctx.fill();
  ctx.restore();

  const inset = 8;
  const ix = x + inset;
  const iy = y + inset;
  const iw = CARD_W - inset * 2;
  const ih = CARD_H - inset * 2;
  const grad = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
  grad.addColorStop(0, "#27489e");
  grad.addColorStop(1, "#0e1d52");
  roundRect(ctx, ix, iy, iw, ih, 8);
  ctx.fillStyle = grad;
  ctx.fill();

  // Diamond lattice.
  ctx.save();
  roundRect(ctx, ix, iy, iw, ih, 8);
  ctx.clip();
  ctx.strokeStyle = "rgba(227,183,74,0.38)";
  ctx.lineWidth = 1.4;
  for (let d = -ih; d < iw + ih; d += 14) {
    ctx.beginPath();
    ctx.moveTo(ix + d, iy);
    ctx.lineTo(ix + d + ih, iy + ih);
    ctx.moveTo(ix + d + ih, iy);
    ctx.lineTo(ix + d, iy + ih);
    ctx.stroke();
  }
  ctx.restore();

  // Emblem.
  const cx = x + CARD_W / 2;
  const cy = y + CARD_H / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 26);
  ctx.lineTo(cx + 18, cy);
  ctx.lineTo(cx, cy + 26);
  ctx.lineTo(cx - 18, cy);
  ctx.closePath();
  ctx.fillStyle = "#0e1d52";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = GOLD;
  ctx.stroke();

  roundRect(ctx, ix, iy, iw, ih, 8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
}

/* ------------------------------ layout bits ------------------------------ */

function drawFelt(ctx: SKRSContext2D): void {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 560);
  bg.addColorStop(0, "#23885a");
  bg.addColorStop(0.55, "#146339");
  bg.addColorStop(1, "#06261a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Fine felt grain.
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#000";
  for (let gy = 0; gy < H; gy += 4) ctx.fillRect(0, gy, W, 1);
  ctx.globalAlpha = 1;

  roundRect(ctx, 14, 14, W - 28, H - 28, 26);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(227,183,74,0.6)";
  ctx.stroke();
  roundRect(ctx, 24, 24, W - 48, H - 48, 20);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(227,183,74,0.25)";
  ctx.stroke();
}

function drawPill(ctx: SKRSContext2D, x: number, cy: number, text: string, bg: string, fg: string): number {
  ctx.font = `bold 22px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  roundRect(ctx, x, cy - 17, w, 34, 17);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, cy + 1);
  return w;
}

function measurePill(ctx: SKRSContext2D, text: string): number {
  ctx.font = `bold 22px ${FONT}`;
  return Math.ceil(ctx.measureText(text).width) + 28;
}

interface Pill {
  text: string;
  bg: string;
  fg: string;
}

function drawHeader(ctx: SKRSContext2D, label: string, cy: number, pill: Pill): void {
  ctx.font = `bold 20px ${FONT}`;
  const labelW = ctx.measureText(label).width;
  const gap = 14;
  const total = labelW + gap + measurePill(ctx, pill.text);
  const x0 = (W - total) / 2;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText(label, x0, cy + 1);
  drawPill(ctx, x0 + labelW + gap, cy, pill.text, pill.bg, pill.fg);
}

function drawHand(ctx: SKRSContext2D, cards: readonly Card[], y: number, hideSecond: boolean): void {
  const avail = W - 120;
  const step = cards.length <= 1 ? 0 : Math.min(CARD_W + 14, (avail - CARD_W) / (cards.length - 1));
  const startX = (W - (CARD_W + step * (cards.length - 1))) / 2;
  cards.forEach((card, i) => {
    const x = startX + step * i;
    if (hideSecond && i === 1) drawFaceDown(ctx, x, y);
    else drawFaceUp(ctx, x, y, card);
  });
}

function drawChip(ctx: SKRSContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.setLineDash([9, 9]);
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.stroke();
}

const fmt = (n: number) => n.toLocaleString("en-US");

const BANNERS: Record<Outcome, { label: string; from: string; to: string; fg: string }> = {
  blackjack: { label: "BLACKJACK!", from: "#f8dc7a", to: "#c9992b", fg: "#2b2108" },
  win: { label: "YOU WIN", from: "#34d17b", to: "#1b8a4b", fg: "#ffffff" },
  push: { label: "PUSH", from: "#9aa7ad", to: "#6b787e", fg: "#ffffff" },
  lose: { label: "YOU LOSE", from: "#ee5a49", to: "#a5301f", fg: "#ffffff" },
  bust: { label: "BUST", from: "#ee5a49", to: "#a5301f", fg: "#ffffff" },
  "dealer-blackjack": { label: "DEALER BLACKJACK", from: "#ee5a49", to: "#a5301f", fg: "#ffffff" },
};

function drawBanner(ctx: SKRSContext2D, cx: number, cy: number, outcome: Outcome, net: number): void {
  const b = BANNERS[outcome];
  const delta = net === 0 ? "" : `${net > 0 ? "+" : "-"}${fmt(Math.abs(net))}`;
  ctx.font = `bold 30px ${FONT}`;
  const labelW = ctx.measureText(b.label).width;
  const deltaW = delta ? ctx.measureText(delta).width : 0;
  const gap = delta ? 18 : 0;
  const w = Math.max(240, labelW + gap + deltaW + 56);
  const h = 66;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 16);
  const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  g.addColorStop(0, b.from);
  g.addColorStop(1, b.to);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 16);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.stroke();

  const x0 = cx - (labelW + gap + deltaW) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = b.fg;
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillText(b.label, x0, cy + 2);
  if (delta) {
    ctx.globalAlpha = 0.85;
    ctx.fillText(delta, x0 + labelW + gap, cy + 2);
    ctx.globalAlpha = 1;
  }
}

/* -------------------------------- public -------------------------------- */

function playerPill(game: BlackjackGame): Pill {
  const { total, soft } = handValue(game.player);
  if (total > 21) return { text: "BUST", bg: "#c0392b", fg: "#fff" };
  if (isBlackjack(game.player)) return { text: "BLACKJACK", bg: GOLD, fg: "#2b2108" };
  const text = soft && total < 21 ? `Soft ${total}` : String(total);
  if (total === 21) return { text, bg: GOLD, fg: "#2b2108" };
  return { text, bg: "rgba(0,0,0,0.45)", fg: "#fff" };
}

function dealerPill(game: BlackjackGame): Pill {
  if (!game.finished) return { text: "?", bg: "rgba(0,0,0,0.45)", fg: "#fff" };
  const total = game.dealerTotal;
  if (total > 21) return { text: "BUST", bg: "#c0392b", fg: "#fff" };
  if (isBlackjack(game.dealer)) return { text: "BLACKJACK", bg: GOLD, fg: "#2b2108" };
  return { text: String(total), bg: "rgba(0,0,0,0.45)", fg: "#fff" };
}

/** Render the current state of a hand. Mid-hand, the dealer's second card is face down. */
export async function renderBlackjackTable(game: BlackjackGame): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  drawFelt(ctx);

  drawHeader(ctx, "DEALER", 54, dealerPill(game));
  drawHand(ctx, game.dealer, 78, !game.finished);

  // Middle band: bet on the left, banner (or table rules) on the right.
  const midY = 308;
  drawChip(ctx, 112, midY, game.doubled ? "#1f4fa8" : "#b8322a");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(game.doubled ? "DOUBLED BET" : "BET", 166, midY - 12);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 36px ${FONT}`;
  ctx.fillText(fmt(game.stake), 166, midY + 24);

  if (game.finished && game.outcome) {
    drawBanner(ctx, 580, midY, game.outcome, game.net());
  } else {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(227,183,74,0.8)";
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText("BLACKJACK PAYS 3 TO 2", 580, midY - 10);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `15px ${FONT}`;
    ctx.fillText("Dealer stands on all 17s", 580, midY + 16);
  }

  drawHeader(ctx, "YOU", 394, playerPill(game));
  drawHand(ctx, game.player, 418, false);

  return canvas.encode("png");
}
