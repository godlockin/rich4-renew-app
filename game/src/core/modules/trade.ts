import type { Game } from '../game';
import { HAND_LIMIT, handSlots, stackOf } from './cards';

export interface ShareTransfer {
  company: number;
  amount: number;
}

export interface TradeOffer {
  from: number;
  to: number;
  cashFrom?: number;
  cashTo?: number;
  landsFrom?: number[];
  landsTo?: number[];
  cardsFrom?: number[];
  cardsTo?: number[];
  sharesFrom?: ShareTransfer[];
  sharesTo?: ShareTransfer[];
}

export type TradeValidation = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): TradeValidation => ({ ok: false, reason });

function countIds(ids: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function removeCards(hand: readonly number[], toRemove: readonly number[]): number[] {
  const next = [...hand];
  for (const id of toRemove) {
    const idx = next.indexOf(id);
    if (idx >= 0) next.splice(idx, 1);
  }
  return next;
}

function validateLands(g: Game, landIds: readonly number[], expectedOwner: number): string | null {
  const seen = new Set<number>();
  for (const id of landIds) {
    if (!Number.isInteger(id)) return `無效的土地編號 ${id}`;
    if (seen.has(id)) return `土地 #${id} 重複出現在交易清單中`;
    seen.add(id);
    const land = g.board.lands.find(l => l.id === id);
    if (!land) return `土地 #${id} 不存在`;
    if (land.owner !== expectedOwner) return `玩家未擁有土地 ${land.name || `#${id}`}`;
    if ((land.tmpState >> 4) > 0 && (land.tmpState & 0xf) !== 0) {
      return `土地 ${land.name || `#${id}`} 查封中，無法交易`;
    }
  }
  return null;
}

function validateCards(
  g: Game,
  handFrom: readonly number[],
  handTo: readonly number[],
  cardsFrom: readonly number[],
  cardsTo: readonly number[],
): string | null {
  for (const id of cardsFrom) {
    if (!Number.isInteger(id) || id <= 0) return `無效的卡片編號 ${id}`;
  }
  for (const id of cardsTo) {
    if (!Number.isInteger(id) || id <= 0) return `無效的卡片編號 ${id}`;
  }

  const ownedFrom = countIds(handFrom);
  for (const [id, need] of countIds(cardsFrom)) {
    if ((ownedFrom.get(id) ?? 0) < need) return `發起方未持有足夠的卡片 #${id}`;
  }

  const ownedTo = countIds(handTo);
  for (const [id, need] of countIds(cardsTo)) {
    if ((ownedTo.get(id) ?? 0) < need) return `對方未持有足夠的卡片 #${id}`;
  }

  const stack = stackOf(g);
  const afterFrom = [...removeCards(handFrom, cardsFrom), ...cardsTo];
  if (handSlots(afterFrom, stack) > HAND_LIMIT) return '發起方卡片欄位不足';

  const afterTo = [...removeCards(handTo, cardsTo), ...cardsFrom];
  if (handSlots(afterTo, stack) > HAND_LIMIT) return '對方卡片欄位不足';

  return null;
}

function validateShares(g: Game, pid: number, shares: readonly ShareTransfer[], label: string): string | null {
  const totals = new Map<number, number>();
  const stockCount = g.stocks.stocks.length;
  for (const item of shares) {
    if (!Number.isInteger(item.company) || item.company < 0 || item.company >= stockCount) {
      return `無效的股票代碼 ${item.company}`;
    }
    if (!Number.isInteger(item.amount) || item.amount <= 0) {
      return `無效的股數 ${item.amount}`;
    }
    totals.set(item.company, (totals.get(item.company) ?? 0) + item.amount);
  }
  for (const [slot, need] of totals) {
    const held = g.stocks.holding(pid, slot).shares;
    if (held < need) return `${label}股票 #${slot} 持股不足（持有 ${held}，需要 ${need}）`;
  }
  return null;
}

/** Validate a player-to-player free trade offer without mutating game state. */
export function validateTrade(g: Game, offer: TradeOffer): TradeValidation {
  if (!Number.isInteger(offer.from) || !Number.isInteger(offer.to)) return fail('無效的玩家編號');
  const pFrom = g.players[offer.from];
  const pTo = g.players[offer.to];
  if (!pFrom || !pTo) return fail('玩家不存在');
  if (offer.from === offer.to) return fail('不能與自己交易');
  if (pFrom.bankrupt || pTo.bankrupt) return fail('已破產的玩家無法進行交易');

  const cashFrom = offer.cashFrom ?? 0;
  const cashTo = offer.cashTo ?? 0;
  if (!Number.isInteger(cashFrom) || cashFrom < 0 || !Number.isInteger(cashTo) || cashTo < 0) {
    return fail('交易現金必須為非負整數');
  }
  if (pFrom.cash < cashFrom) return fail('發起方現金不足');
  if (pTo.cash < cashTo) return fail('對方現金不足');

  const landsErrFrom = validateLands(g, offer.landsFrom ?? [], pFrom.id + 1);
  if (landsErrFrom) return fail(landsErrFrom);
  const landsErrTo = validateLands(g, offer.landsTo ?? [], pTo.id + 1);
  if (landsErrTo) return fail(landsErrTo);

  const cardsErr = validateCards(g, pFrom.cards, pTo.cards, offer.cardsFrom ?? [], offer.cardsTo ?? []);
  if (cardsErr) return fail(cardsErr);

  const sharesErrFrom = validateShares(g, pFrom.id, offer.sharesFrom ?? [], '發起方');
  if (sharesErrFrom) return fail(sharesErrFrom);
  const sharesErrTo = validateShares(g, pTo.id, offer.sharesTo ?? [], '對方');
  if (sharesErrTo) return fail(sharesErrTo);

  return { ok: true };
}

/** Atomically execute a validated trade offer. Returns true on success or false if validation fails. */
export function executeTrade(g: Game, offer: TradeOffer): boolean {
  if (!validateTrade(g, offer).ok) return false;

  const pFrom = g.players[offer.from];
  const pTo = g.players[offer.to];

  const cashFrom = offer.cashFrom ?? 0;
  const cashTo = offer.cashTo ?? 0;
  pFrom.cash = pFrom.cash - cashFrom + cashTo;
  pTo.cash = pTo.cash - cashTo + cashFrom;

  for (const id of offer.landsFrom ?? []) {
    const land = g.board.lands.find(l => l.id === id);
    if (land) land.owner = pTo.id + 1;
  }
  for (const id of offer.landsTo ?? []) {
    const land = g.board.lands.find(l => l.id === id);
    if (land) land.owner = pFrom.id + 1;
  }

  const cardsFrom = offer.cardsFrom ?? [];
  const cardsTo = offer.cardsTo ?? [];
  if (cardsFrom.length || cardsTo.length) {
    for (const id of cardsFrom) {
      const idx = pFrom.cards.indexOf(id);
      if (idx >= 0) pFrom.cards.splice(idx, 1);
    }
    for (const id of cardsTo) {
      const idx = pTo.cards.indexOf(id);
      if (idx >= 0) pTo.cards.splice(idx, 1);
    }
    pFrom.cards.push(...cardsTo);
    pTo.cards.push(...cardsFrom);
  }

  for (const { company, amount } of offer.sharesFrom ?? []) {
    g.stocks.transferShares(pFrom.id, pTo.id, company, amount, g.stocks.stocks[company].price);
  }
  for (const { company, amount } of offer.sharesTo ?? []) {
    g.stocks.transferShares(pTo.id, pFrom.id, company, amount, g.stocks.stocks[company].price);
  }

  return true;
}
