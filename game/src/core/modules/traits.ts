/**
 * Character Trait Mode (optional `settings.traits`):
 * Distinct passive traits for all 12 characters (CHARACTERS 0..11).
 * When `g.settings.traits` is false or omitted, none of these modifiers apply,
 * keeping classic/golden mode 100% bit-exact.
 */
import type { Game } from '../game';
import type { Player } from '../types';
import { cardPrice } from './cards';

export interface CharacterTrait {
  characterId: number;
  id: string;
  name: string;
  description: string;
  /** Discount rate on building/upgrading own land or facility (e.g. 0.2 = 20% off). */
  buildDiscountRate?: number;
  /** Discount rate on buying unowned land or facility (e.g. 0.1 = 10% off). */
  buyLandDiscountRate?: number;
  /** Multiplier on toll/facility fee income collected as owner (e.g. 1.15 = +15%). */
  tollIncomeMult?: number;
  /** Discount rate on tolls/facility fees paid as visitor (e.g. 0.15 = 15% off). */
  tollPayDiscountRate?: number;
  /** Extra monthly bank interest rate added on top of base 10% (e.g. 0.02 = +2%). */
  bankInterestBonusRate?: number;
  /** Discount rate on taxes paid to system (e.g. 0.5 = 50% off). */
  taxDiscountRate?: number;
  /** Extra steps added when rolling on motorcycle (traffic === 1). */
  motorcycleDiceBonus?: number;
  /** Extra steps added when rolling in car (traffic === 2). */
  carDiceBonus?: number;
  /** Discount/rebate rate on card purchases at the shop (e.g. 0.2 = 20% off). */
  cardShopDiscountRate?: number;
  /** Bonus rate on points gained from point squares (e.g. 0.25 = +25%). */
  pointsBonusRate?: number;
  /** Flat bonus points gained when landing on news/fate squares. */
  eventPointsBonus?: number;
  /** Extra cash dividend bonus rate on stock dividend payouts (e.g. 0.2 = +20%). */
  dividendBonusRate?: number;
  /** Extra starting points at game start. */
  startingPoints?: number;
  /** Flat monthly cash allowance (scaled by priceIndex) on newMonth. */
  monthlyAllowance?: number;
}

export const CHARACTER_TRAITS: readonly CharacterTrait[] = [
  {
    characterId: 0,
    id: 'wall-street-pulse',
    name: '華爾街脈動',
    description: '每月 15 日領取股息時額外獲得 20% 現金紅利',
    dividendBonusRate: 0.2,
  },
  {
    characterId: 1,
    id: 'oil-magnate',
    name: '石油霸主',
    description: '收取土地過路費與大型設施費用時收入 +15%',
    tollIncomeMult: 1.15,
  },
  {
    characterId: 2,
    id: 'swift-ninjutsu',
    name: '疾風忍術',
    description: '騎乘機車移動時擲骰總步數 +1',
    motorcycleDiceBonus: 1,
  },
  {
    characterId: 3,
    id: 'savvy-finance',
    name: '精明理財',
    description: '銀行月結存款利息額外 +2%，且繳納各類稅金減免 50%',
    bankInterestBonusRate: 0.02,
    taxDiscountRate: 0.5,
  },
  {
    characterId: 4,
    id: 'master-builder',
    name: '老實築夢',
    description: '土地升級、大型設施興建與升級費用享 20% 折扣',
    buildDiscountRate: 0.2,
  },
  {
    characterId: 5,
    id: 'royal-grace',
    name: '皇室氣場',
    description: '支付他人土地過路費與大型設施費用時減免 15%',
    tollPayDiscountRate: 0.15,
  },
  {
    characterId: 6,
    id: 'bushido-spirit',
    name: '武士道',
    description: '踩到點券格時獲得的點券額外 +25%',
    pointsBonusRate: 0.25,
  },
  {
    characterId: 7,
    id: 'sweet-bargain',
    name: '甜心議價',
    description: '購買無主空地與大型設施空地時費用享 10% 折扣',
    buyLandDiscountRate: 0.1,
  },
  {
    characterId: 8,
    id: 'forager',
    name: '原野採集',
    description: '踩到新聞或命運格時額外獲得 10 點券',
    eventPointsBonus: 10,
  },
  {
    characterId: 9,
    id: 'thrifty-shopper',
    name: '精打細算',
    description: '在道具店購買卡片享 20% 點券折扣（即時返還）',
    cardShopDiscountRate: 0.2,
  },
  {
    characterId: 10,
    id: 'turbo-racer',
    name: '極速狂飆',
    description: '駕駛汽車移動時擲骰總步數 +2',
    carDiceBonus: 2,
  },
  {
    characterId: 11,
    id: 'lucky-baby',
    name: '招財寶寶',
    description: '開局初始點券 +50，且每月結算額外獲得 2,000 × 物價指數零用金',
    startingPoints: 50,
    monthlyAllowance: 2000,
  },
];

export function getCharacterTrait(characterId: number): CharacterTrait | undefined {
  return CHARACTER_TRAITS[characterId];
}

export function traitBuyLandCost(g: Game, p: Player, baseCost: number): number {
  if (!g.settings.traits) return baseCost;
  const rate = getCharacterTrait(p.character)?.buyLandDiscountRate ?? 0;
  return rate > 0 ? Math.max(0, Math.round(baseCost * (1 - rate))) : baseCost;
}

export function traitBuildCost(g: Game, p: Player, baseCost: number): number {
  if (!g.settings.traits) return baseCost;
  const rate = getCharacterTrait(p.character)?.buildDiscountRate ?? 0;
  return rate > 0 ? Math.max(0, Math.round(baseCost * (1 - rate))) : baseCost;
}

export function traitTollIncome(g: Game, owner: Player, baseAmount: number): number {
  if (!g.settings.traits || baseAmount <= 0) return baseAmount;
  const mult = getCharacterTrait(owner.character)?.tollIncomeMult ?? 1;
  return mult !== 1 ? Math.round(baseAmount * mult) : baseAmount;
}

export function traitTollPay(g: Game, payer: Player, amount: number): number {
  if (!g.settings.traits || amount <= 0) return amount;
  const rate = getCharacterTrait(payer.character)?.tollPayDiscountRate ?? 0;
  return rate > 0 ? Math.max(0, Math.round(amount * (1 - rate))) : amount;
}

export function traitTaxAmount(g: Game, payer: Player, amount: number): number {
  if (!g.settings.traits || amount <= 0) return amount;
  const rate = getCharacterTrait(payer.character)?.taxDiscountRate ?? 0;
  return rate > 0 ? Math.max(0, Math.round(amount * (1 - rate))) : amount;
}

export function traitBankInterestBonus(g: Game, p: Player): number {
  if (!g.settings.traits || p.loan !== 0) return 0;
  const rate = getCharacterTrait(p.character)?.bankInterestBonusRate ?? 0;
  if (rate <= 0) return 0;
  const base = g.finance.interestBase(p);
  return base > 0 ? Math.trunc(base * rate) : 0;
}

export function traitStepBonus(g: Game, p: Player): number {
  if (!g.settings.traits || p.turtle) return 0;
  const trait = getCharacterTrait(p.character);
  if (!trait) return 0;
  const vehicle = p.traffic & 3;
  if (vehicle === 1) return trait.motorcycleDiceBonus ?? 0;
  if (vehicle === 2) return trait.carDiceBonus ?? 0;
  return 0;
}

export function traitPointsAmount(g: Game, p: Player, baseAmount: number): number {
  if (!g.settings.traits || baseAmount <= 0) return baseAmount;
  const rate = getCharacterTrait(p.character)?.pointsBonusRate ?? 0;
  return rate > 0 ? Math.round(baseAmount * (1 + rate)) : baseAmount;
}

export function traitEventPointsBonus(g: Game, p: Player): number {
  if (!g.settings.traits) return 0;
  return getCharacterTrait(p.character)?.eventPointsBonus ?? 0;
}

export function traitCardShopRebate(
  g: Game,
  p: Player,
  beforeCards: ReadonlyMap<number, number>,
  beforePoints: number,
): number {
  if (!g.settings.traits) return 0;
  const rate = getCharacterTrait(p.character)?.cardShopDiscountRate ?? 0;
  if (rate <= 0) return 0;
  const spent = Math.max(0, beforePoints - p.points);
  if (spent === 0) return 0;
  const afterCards = new Map<number, number>();
  for (const id of p.cards) afterCards.set(id, (afterCards.get(id) ?? 0) + 1);
  let cardSpend = 0;
  for (const [id, count] of afterCards) {
    const added = count - (beforeCards.get(id) ?? 0);
    if (added > 0) cardSpend += cardPrice(id) * added;
  }
  const eligible = Math.min(spent, cardSpend);
  return eligible > 0 ? Math.round(eligible * rate) : 0;
}

export function traitDividendBonus(g: Game, p: Player, dividendReceived: number): number {
  if (!g.settings.traits || dividendReceived <= 0) return 0;
  const rate = getCharacterTrait(p.character)?.dividendBonusRate ?? 0;
  return rate > 0 ? Math.round(dividendReceived * rate) : 0;
}

export function traitStartingPoints(g: Game, p: Player): number {
  if (!g.settings.traits) return 0;
  return getCharacterTrait(p.character)?.startingPoints ?? 0;
}

export function traitMonthlyAllowance(g: Game, p: Player): number {
  if (!g.settings.traits) return 0;
  const base = getCharacterTrait(p.character)?.monthlyAllowance ?? 0;
  return base > 0 ? base * g.priceIndex : 0;
}
