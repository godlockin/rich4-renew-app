import { describe, expect, it } from 'vitest';
import type { Board } from '../board';
import { pack } from '../date';
import { Game } from '../game';
import type { GameSettings } from '../types';
import { HAND_LIMIT } from './cards';
import { executeTrade, validateTrade, type TradeOffer } from './trade';

function makeBoard(): Board {
  const N = 15;
  const nodes = [
    { id: 0, x: 0, y: 0, adjacent: [0, 0, 0, 0], oneWay: 0, ref: 0, event: 0, aux: 0, noDrop: true },
    ...Array.from({ length: N }, (_, k) => {
      const id = k + 1;
      return {
        id,
        x: 100 + k * 20,
        y: 100,
        adjacent: [id < N ? id + 1 : 1, 0, id > 1 ? id - 1 : N, 0],
        oneWay: 0,
        ref: id === 2 ? 2001 : id === 3 ? 2002 : 0,
        event: 0,
        aux: 0,
        noDrop: false,
      };
    }),
  ];
  const lands = [
    {
      id: 1, name: 'TestStA', x: 120, y: 100, price: 2000, perLevel: 1000,
      tolls: [200, 600, 1400, 3000, 6000, 10000], owner: 0, level: 0, chain: false,
      tmpState: 0, facing: 0, lastToll: 0, expire: 0,
    },
    {
      id: 2, name: 'TestStB', x: 140, y: 100, price: 3000, perLevel: 1500,
      tolls: [300, 900, 2100, 4500, 9000, 15000], owner: 0, level: 0, chain: false,
      tmpState: 0, facing: 0, lastToll: 0, expire: 0,
    },
  ];
  return { name: 'Mini', mapId: 0, nodes, lands, facilities: [], companies: [], landscapes: [] };
}

function makeGame(seed = 1): Game {
  const settings: GameSettings = {
    mapId: 0,
    players: [0, 1, 2, 3].map(character => ({ character, human: false })),
    fundIndex: 1,
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate: pack(2026, 10, 14),
    seed,
  };
  const g = new Game(settings, makeBoard());
  for (const p of g.players) {
    p.whoPlays = 2;
    p.placed = true;
  }
  return g;
}

describe('player-to-player free trade (CARD-204)', () => {
  it('executes a valid multi-asset trade (cash, lands, cards, shares)', () => {
    const g = makeGame();
    const [p0, p1] = g.players;
    p0.cash = 50_000;
    p1.cash = 30_000;

    const landA = g.board.lands[0];
    const landB = g.board.lands[1];
    landA.owner = p0.id + 1;
    landB.owner = p1.id + 1;

    p0.cards = [1, 2, 2];
    p1.cards = [5, 8];

    p0.bank = 1_000_000;
    p1.bank = 1_000_000;
    g.stocks.stocks[1].turnQuota = 1000;
    g.stocks.stocks[2].turnQuota = 1000;
    g.stocks.buyMarket(p0, 1, 100);
    g.stocks.buyMarket(p1, 2, 80);
    expect(g.stocks.holding(p0.id, 1).shares).toBe(100);
    expect(g.stocks.holding(p1.id, 2).shares).toBe(80);

    const offer: TradeOffer = {
      from: p0.id,
      to: p1.id,
      cashFrom: 10_000,
      cashTo: 5_000,
      landsFrom: [landA.id],
      landsTo: [landB.id],
      cardsFrom: [2, 2],
      cardsTo: [5],
      sharesFrom: [{ company: 1, amount: 40 }],
      sharesTo: [{ company: 2, amount: 30 }],
    };

    expect(validateTrade(g, offer)).toEqual({ ok: true });
    expect(executeTrade(g, offer)).toBe(true);

    expect(p0.cash).toBe(45_000);
    expect(p1.cash).toBe(35_000);
    expect(landA.owner).toBe(p1.id + 1);
    expect(landB.owner).toBe(p0.id + 1);
    expect(p0.cards).toEqual([1, 5]);
    expect(p1.cards).toEqual([8, 2, 2]);
    expect(g.stocks.holding(p0.id, 1).shares).toBe(60);
    expect(g.stocks.holding(p1.id, 1).shares).toBe(40);
    expect(g.stocks.holding(p1.id, 2).shares).toBe(50);
    expect(g.stocks.holding(p0.id, 2).shares).toBe(30);
  });

  it('rejects invalid players (same player, out-of-range, bankrupt)', () => {
    const g = makeGame();
    const [p0, p1] = g.players;

    expect(validateTrade(g, { from: 0, to: 0 }).ok).toBe(false);
    expect(validateTrade(g, { from: -1, to: 1 }).ok).toBe(false);
    expect(validateTrade(g, { from: 0, to: 99 }).ok).toBe(false);

    p1.bankrupt = true;
    const res = validateTrade(g, { from: p0.id, to: p1.id, cashFrom: 100 });
    expect(res.ok).toBe(false);
    expect(executeTrade(g, { from: p0.id, to: p1.id, cashFrom: 100 })).toBe(false);
  });

  it('rejects insufficient or negative cash', () => {
    const g = makeGame();
    const [p0, p1] = g.players;
    p0.cash = 1_000;
    p1.cash = 2_000;

    expect(validateTrade(g, { from: 0, to: 1, cashFrom: 1_500 }).ok).toBe(false);
    expect(validateTrade(g, { from: 0, to: 1, cashTo: 2_500 }).ok).toBe(false);
    expect(validateTrade(g, { from: 0, to: 1, cashFrom: -100 }).ok).toBe(false);
    expect(executeTrade(g, { from: 0, to: 1, cashFrom: 1_500 })).toBe(false);
    expect(p0.cash).toBe(1_000);
    expect(p1.cash).toBe(2_000);
  });

  it('rejects unowned, duplicate, or sealed lands', () => {
    const g = makeGame();
    const [p0, p1] = g.players;
    const land0 = g.board.lands[0];
    const land1 = g.board.lands[1];
    land0.owner = p0.id + 1;
    land1.owner = p1.id + 1;

    // Unowned / wrong owner
    expect(validateTrade(g, { from: 0, to: 1, landsFrom: [land1.id] }).ok).toBe(false);
    // Duplicate land id
    expect(validateTrade(g, { from: 0, to: 1, landsFrom: [land0.id, land0.id] }).ok).toBe(false);
    // Sealed land (tmpState high nibble = days, low nibble = 1)
    land0.tmpState = 0x31;
    expect(validateTrade(g, { from: 0, to: 1, landsFrom: [land0.id] }).ok).toBe(false);
    // Price-boosted land (tmpState low nibble = 0) is NOT sealed and should still be tradeable
    land0.tmpState = 0x30;
    expect(validateTrade(g, { from: 0, to: 1, landsFrom: [land0.id] })).toEqual({ ok: true });
  });

  it('rejects missing cards or exceeding target card slot limit, while allowing equal-swap at full hand', () => {
    const g = makeGame();
    const [p0, p1] = g.players;
    p0.cards = [1, 2];
    p1.cards = new Array(HAND_LIMIT).fill(3);

    // Missing card
    expect(validateTrade(g, { from: 0, to: 1, cardsFrom: [1, 1] }).ok).toBe(false);
    // Target hand full (15 cards, receiving 1 without giving any)
    expect(validateTrade(g, { from: 0, to: 1, cardsFrom: [1] }).ok).toBe(false);
    // Target hand full, but trading 1-for-1 keeps slot count at 15
    expect(validateTrade(g, { from: 0, to: 1, cardsFrom: [1], cardsTo: [3] })).toEqual({ ok: true });
  });

  it('rejects insufficient shares including aggregated duplicate entries', () => {
    const g = makeGame();
    const [p0, p1] = g.players;
    p0.bank = 1_000_000;
    g.stocks.stocks[0].turnQuota = 500;
    g.stocks.buyMarket(p0, 0, 50);

    expect(validateTrade(g, { from: 0, to: 1, sharesFrom: [{ company: 0, amount: 51 }] }).ok).toBe(false);
    expect(
      validateTrade(g, {
        from: 0,
        to: 1,
        sharesFrom: [
          { company: 0, amount: 30 },
          { company: 0, amount: 30 },
        ],
      }).ok,
    ).toBe(false);
    expect(validateTrade(g, { from: 0, to: 1, sharesFrom: [{ company: 99, amount: 1 }] }).ok).toBe(false);
    expect(validateTrade(g, { from: 0, to: 1, sharesFrom: [{ company: 0, amount: 0 }] }).ok).toBe(false);
    expect(p0.id).not.toBe(p1.id);
  });

  it('is atomic: leaves all state untouched when any part of a multi-asset offer fails', () => {
    const g = makeGame();
    const [p0, p1] = g.players;
    p0.cash = 20_000;
    p1.cash = 15_000;

    const land0 = g.board.lands[0];
    const land1 = g.board.lands[1];
    land0.owner = p0.id + 1;
    land1.owner = p1.id + 1;

    p0.cards = [1, 2];
    p1.cards = [3, 4];

    p0.bank = 1_000_000;
    g.stocks.stocks[1].turnQuota = 500;
    g.stocks.buyMarket(p0, 1, 50);

    // Cash, lands, and cards are valid, but sharesFrom exceeds holding (50 < 100)
    const badOffer: TradeOffer = {
      from: p0.id,
      to: p1.id,
      cashFrom: 5_000,
      cashTo: 2_000,
      landsFrom: [land0.id],
      landsTo: [land1.id],
      cardsFrom: [1],
      cardsTo: [3],
      sharesFrom: [{ company: 1, amount: 100 }],
    };

    expect(executeTrade(g, badOffer)).toBe(false);

    // Nothing mutated
    expect(p0.cash).toBe(20_000);
    expect(p1.cash).toBe(15_000);
    expect(land0.owner).toBe(p0.id + 1);
    expect(land1.owner).toBe(p1.id + 1);
    expect(p0.cards).toEqual([1, 2]);
    expect(p1.cards).toEqual([3, 4]);
    expect(g.stocks.holding(p0.id, 1).shares).toBe(50);
    expect(g.stocks.holding(p1.id, 1).shares).toBe(0);
  });
});
