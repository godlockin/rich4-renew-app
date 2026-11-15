import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { pack } from './date';
import { Game } from './game';
import { computeStateHash } from './state-hash';
import type { GameSettings } from './types';

function makeBoard(): Board {
  const N = 15;
  const nodes = [
    { id: 0, x: 0, y: 0, adjacent: [0, 0, 0, 0], oneWay: 0, dir: 0, ref: 0, event: 0, aux: 0, noDrop: true },
    ...Array.from({ length: N }, (_, k) => {
      const id = k + 1;
      return {
        id,
        x: 100 + k * 20,
        y: 100,
        adjacent: [id < N ? id + 1 : 1, 0, id > 1 ? id - 1 : N, 0],
        oneWay: 0,
        dir: 0,
        ref: id === 2 ? 2001 : id === 4 ? 4001 : 0,
        event: 0,
        aux: 0,
        noDrop: false,
      };
    }),
  ];
  const lands = [{
    id: 1, name: 'TestSt', x: 120, y: 100, price: 2000, perLevel: 1000,
    tolls: [200, 600, 1400, 3000, 6000, 10000], owner: 1, level: 0, chain: false,
    tmpState: 0, facing: 0, lastToll: 0, expire: 0,
  }];
  const facilities = [{
    id: 1, name: 'TestFac', x: 160, y: 100, type: 1, owner: 0, level: 0,
    tmpState: 0, labTool: 0, labDays: 0, price: 3000, fees: [300, 600, 1200, 2400, 4800, 9600],
    lastFee: 0, expire: 0,
  }];
  return { name: 'Mini', mapId: 0, nodes, lands, facilities, companies: [], landscapes: [] };
}

function makeGame(seed = 42): Game {
  const settings: GameSettings = {
    mapId: 0,
    players: [{ character: 0, human: false }, { character: 1, human: false }],
    fundIndex: 1,
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate: pack(2026, 10, 14),
    seed,
    aiLevel: 2,
  };
  const g = new Game(settings, makeBoard());
  g.animation = false;
  return g;
}

describe('computeStateHash', () => {
  it('is deterministic for identical games and returns an unsigned 32-bit integer', () => {
    const g1 = makeGame(12345);
    const g2 = makeGame(12345);
    const h1 = computeStateHash(g1);
    const h2 = computeStateHash(g2);
    expect(h1).toBe(h2);
    expect(Number.isInteger(h1)).toBe(true);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThanOrEqual(0xffffffff);
    expect(computeStateHash(g1)).toBe(h1);
  });

  it('is sensitive to rng seed changes', () => {
    const g = makeGame(100);
    const base = computeStateHash(g);
    g.rng.rand();
    expect(computeStateHash(g)).not.toBe(base);
  });

  it('is sensitive to player state mutations', () => {
    const fields: Array<(g: Game) => void> = [
      g => { g.players[0].cash += 1; },
      g => { g.players[0].bank += 100; },
      g => { g.players[0].loan += 500; },
      g => { g.players[0].node = (g.players[0].node % 15) + 1; },
      g => { g.players[0].points += 10; },
      g => { g.players[0].cards.push(1); },
      g => { g.players[0].tools[0] += 1; },
      g => { g.players[0].hospital = 3; },
      g => { g.players[0].prison = 2; },
      g => { g.players[0].sleep = 1; },
    ];
    for (const mutate of fields) {
      const g = makeGame(77);
      const base = computeStateHash(g);
      mutate(g);
      expect(computeStateHash(g)).not.toBe(base);
    }
  });

  it('is sensitive to board.lands and board.facilities mutations', () => {
    const mutators: Array<(g: Game) => void> = [
      g => { g.board.lands[0].owner = 2; },
      g => { g.board.lands[0].level = 3; },
      g => { g.board.lands[0].tmpState = 0x51; },
      g => { g.board.facilities[0].owner = 1; },
      g => { g.board.facilities[0].type = 2; },
      g => { g.board.facilities[0].level = 4; },
      g => { g.board.facilities[0].tmpState = 0x30; },
    ];
    for (const mutate of mutators) {
      const g = makeGame(88);
      const base = computeStateHash(g);
      mutate(g);
      expect(computeStateHash(g)).not.toBe(base);
    }
  });

  it('is sensitive to stock price and holding mutations', () => {
    const g1 = makeGame(99);
    const base1 = computeStateHash(g1);
    g1.stocks.stocks[0].price = Math.fround(g1.stocks.stocks[0].price + 0.5);
    expect(computeStateHash(g1)).not.toBe(base1);

    const g2 = makeGame(99);
    const base2 = computeStateHash(g2);
    g2.stocks.holdings[0][0].shares += 100;
    expect(computeStateHash(g2)).not.toBe(base2);
  });

  it('is sensitive to map object mutations', () => {
    const mutators: Array<(g: Game) => void> = [
      g => { g.objects.slots[0].type = 2; },
      g => { g.objects.slots[0].node = (g.objects.slots[0].node % 15) + 1; },
      g => { g.objects.slots[0].owner = 1; },
    ];
    for (const mutate of mutators) {
      const g = makeGame(111);
      const base = computeStateHash(g);
      mutate(g);
      expect(computeStateHash(g)).not.toBe(base);
    }
  });
});
