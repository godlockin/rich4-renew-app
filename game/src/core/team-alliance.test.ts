import { describe, expect, it } from 'vitest';
import { Game } from './game';
import type { Board } from './board';
import type { Flow } from './flow';
import type { Ask, GameSettings, Step } from './types';

function makeBoard(): Board {
  const nodes = Array.from({ length: 8 }, (_, i) => {
    const id = i + 1;
    const prev = i === 0 ? 8 : i;
    const next = i + 1 === 8 ? 1 : i + 2;
    return {
      id,
      x: i * 100,
      y: 0,
      event: i === 1 ? 1 : 0,
      ref: i === 1 ? 2001 : 0,
      aux: 0,
      adjacent: [next, prev, 0, 0] as [number, number, number, number],
      oneWay: 0,
      noDrop: false,
    };
  });
  return {
    mapId: 0,
    name: 'Test',
    nodes,
    lands: [
      {
        id: 1,
        name: 'Test St',
        x: 100,
        y: 0,
        facing: 0,
        owner: 0,
        level: 0,
        chain: false,
        price: 1000,
        perLevel: 500,
        tolls: [200, 400, 800, 1200, 1600, 2000],
        tmpState: 0,
        expire: 0,
        lastToll: 0,
      },
    ],
    facilities: [],
    companies: [],
    landscapes: [],
  };
}

function makeSettings(extra: Partial<GameSettings> = {}): GameSettings {
  return {
    mapId: 0,
    players: [
      { character: 0, human: true },
      { character: 1, human: true },
      { character: 2, human: false },
      { character: 3, human: false },
    ],
    fundIndex: 2,
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate: 0,
    seed: 42,
    ...extra,
  };
}

function drain<T>(flow: Flow<T>, answers: Record<string, unknown> = {}): { steps: Step[]; asks: Ask[]; result: T } {
  const steps: Step[] = [];
  const asks: Ask[] = [];
  let n = flow.next();
  while (!n.done) {
    const step = n.value;
    steps.push(step);
    if (step.t === 'pick-map' || step.t === 'choose' || step.t === 'pick-player' || step.t === 'pick-node') {
      asks.push(step as Ask);
      const ans = answers[step.t] ?? -1;
      n = flow.next(ans);
    } else {
      n = flow.next();
    }
  }
  return { steps, asks, result: n.value };
}

describe('CARD-204 Part 2: 2v2 Team Alliance Mode', () => {
  it('leaves default (teams unset) 100% unchanged', () => {
    const g = new Game(makeSettings(), makeBoard());
    for (const p of g.players) {
      expect(p.team).toBeUndefined();
    }
    expect(g.isAlly(g.players[0], g.players[0])).toBe(true);
    expect(g.isAlly(0, 1)).toBe(false);
    expect(g.isAlly(0, 2)).toBe(false);

    // Temporary ally card still works as before
    g.players[0].ally = 2;
    g.players[1].ally = 1;
    expect(g.isAlly(0, 1)).toBe(true);
    g.endAlly(g.players[0]);
    expect(g.isAlly(0, 1)).toBe(false);

    // Single bankruptcy does not end a 4-player FFA game
    drain(g.bankrupt(g.players[2]));
    expect(g.over).toBeNull();
    drain(g.bankrupt(g.players[3]));
    expect(g.over).toBeNull();
  });

  it('exempts fixed-team teammates from paying land/facility toll to each other', () => {
    const g = new Game(makeSettings({ teams: [1, 1, 2, 2] }), makeBoard());
    expect(g.isAlly(0, 1)).toBe(true);
    expect(g.isAlly(2, 3)).toBe(true);
    expect(g.isAlly(0, 2)).toBe(false);

    const p0 = g.players[0];
    const p1 = g.players[1];
    const p2 = g.players[2];
    const land = g.board.lands[0];
    land.owner = p0.id + 1; // owned by P0 (Team 1)
    land.level = 2;

    // P1 (Team 1) lands on P0's lot -> exempt
    g.current = p1.id;
    const p0Before = p0.cash;
    const p1Before = p1.cash;
    const { result: collectsForAlly } = drain(g.ownerCollects(p0, land.tmpState, '過路費'));
    expect(collectsForAlly).toBe(false);
    const { result: paidAlly } = drain(g.collect(p1, p0, 800, '過路費', false));
    expect(paidAlly).toBeNull();
    expect(p0.cash).toBe(p0Before);
    expect(p1.cash).toBe(p1Before);

    // P2 (Team 2) lands on P0's lot -> NOT exempt
    g.current = p2.id;
    const { result: collectsForEnemy } = drain(g.ownerCollects(p0, land.tmpState, '過路費'));
    expect(collectsForEnemy).toBe(true);
    const { result: paidEnemy } = drain(g.collect(p2, p0, 800, '過路費', false));
    expect(paidEnemy).toEqual({ payer: p2.id, amount: 800 });
  });

  it('filters fixed-team allies out of hostile single-target cards and tools', () => {
    const g = new Game(makeSettings({ teams: [1, 1, 2, 2] }), makeBoard());
    for (const p of g.players) {
      p.placed = true;
      p.node = 1;
    }
    const p0 = g.players[0];
    const p1 = g.players[1];
    const p2 = g.players[2];
    const p3 = g.players[3];

    // Even if hostility was somehow raised, mostHostile must not pick a teammate
    p0.hostility[p1.id] = 9999;
    expect(g.cards.mostHostile(p0)).toBe(-1);

    // Human 均貧卡 (2), 搶奪卡 (13), 查稅卡 (26), 陷害卡 (17): teammate P1 is never in pick-map spots
    p1.cash = 100000;
    p2.cash = 100000;
    p3.cash = 100000;
    for (const cardId of [2, 13, 26, 17]) {
      p0.cards = [cardId];
      const { asks } = drain(g.cards.playAs(p0, cardId, -1), {});
      expect(asks).toHaveLength(0);
    }

    // Verify human pick-map spots exclude P1 (Team 1) and only include Team 2 (P2, P3)
    const card2 = (g.cards as unknown as { play: (p: typeof p0, id: number, human: boolean) => Flow<boolean> }).play(p0, 2, true);
    const { asks: asks2 } = drain(card2, { 'pick-map': -1 });
    expect(asks2).toHaveLength(1);
    const ask2 = asks2[0];
    expect(ask2.t).toBe('pick-map');
    if (ask2.t === 'pick-map') {
      const ids = ask2.spots.map(s => s.id);
      expect(ids).not.toContain(p1.id);
      expect(ids).toContain(p2.id);
      expect(ids).toContain(p3.id);
    }

    // Verify 陷害卡 (17) human pick-map excludes teammate P1
    const card17 = (g.cards as unknown as { play: (p: typeof p0, id: number, human: boolean) => Flow<boolean> }).play(p0, 17, true);
    const { asks: asks17 } = drain(card17, { 'pick-map': -1 });
    expect(asks17).toHaveLength(1);
    const ask17 = asks17[0];
    if (ask17.t === 'pick-map') {
      const ids = ask17.spots.map(s => s.id);
      expect(ids).not.toContain(p1.id);
      expect(ids).toContain(p2.id);
      expect(ids).toContain(p3.id);
    }

    // Verify judgeMissile does not target teammate when enemies are out of view
    p2.node = 5;
    p3.node = 6;
    p1.node = 2; // in view (x=100)
    const missileTarget = (g.tools as unknown as { judgeMissile: (p: typeof p0) => number | null }).judgeMissile(p0);
    expect(missileTarget).toBeNull();
  });

  it('declares 2v2 victory when all remaining living players belong to the same team', () => {
    const g = new Game(makeSettings({ teams: [1, 1, 2, 2] }), makeBoard());
    // Eliminate first member of Team 2 -> game continues
    drain(g.bankrupt(g.players[2]));
    expect(g.over).toBeNull();
    expect(g.living().map(p => p.id)).toEqual([0, 1, 3]);

    // Eliminate second member of Team 2 -> Team 1 wins!
    const { steps } = drain(g.bankrupt(g.players[3]));
    expect(g.over).not.toBeNull();
    expect([0, 1]).toContain(g.over!.winner);
    expect(g.over!.code).toBe(3); // multiple humans, human team won
    expect(steps.some(s => s.t === 'gameover' && s.code === 3)).toBe(true);
  });
});
