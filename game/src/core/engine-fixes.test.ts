import { describe, expect, it } from 'vitest';
import { Game, FACILITY_MAX_LEVEL } from './game';
import { World, autoAnswer, tycoonSettings } from './world';
import { playReward } from './rewards';
import type { Board } from './board';
import type { Flow } from './flow';
import type { Ask, GameSettings } from './types';

function makeBoard(nodeCount = 8, withPrison = true): Board {
  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const id = i + 1;
    const prev = i === 0 ? nodeCount : i;
    const next = i + 1 === nodeCount ? 1 : i + 2;
    return {
      id,
      x: i * 100,
      y: 0,
      event: withPrison && i === nodeCount - 1 ? 4 : 0,
      ref: withPrison && i === nodeCount - 1 ? 8002 : 0,
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
    lands: [],
    facilities: [],
    companies: [],
    landscapes: [],
  };
}

function makeSettings(players: { character: number; human: boolean }[], extra: Partial<GameSettings> = {}): GameSettings {
  return {
    mapId: 0,
    players,
    fundIndex: 2, // 100,000
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate: 0,
    seed: 1,
    ...extra,
  };
}

function drain<T>(flow: Flow<T>): { steps: unknown[]; value: T } {
  const steps: unknown[] = [];
  let r = flow.next();
  while (!r.done) {
    steps.push(r.value);
    r = flow.next(undefined);
  }
  return { steps, value: r.value };
}

describe('CARD-101: whoPlays initialization, Day 1 surrender, and all-player effects', () => {
  it('initializes whoPlays immediately in Game and World while keeping placed=false', () => {
    const g = new Game(makeSettings([{ character: 0, human: true }, { character: 1, human: false }]), makeBoard());
    expect(g.players[0].whoPlays).toBe(1);
    expect(g.players[1].whoPlays).toBe(2);
    expect(g.players[0].placed).toBe(false);
    expect(g.players[1].placed).toBe(false);
    expect(g.living().map(p => p.id)).toEqual([0, 1]);

    const ts = tycoonSettings(0);
    const w = new World(ts, ts.maps.map(() => makeBoard()));
    expect(w.players[0].whoPlays).toBe(1);
    expect(w.players[1].whoPlays).toBe(2);
    expect(w.players.every(p => !p.placed)).toBe(true);
  });

  it('allows Day 1 surrender/bankrupt before airdrop', () => {
    const g = new Game(makeSettings([{ character: 0, human: true }, { character: 1, human: false }]), makeBoard());
    expect(g.players[0].placed).toBe(false);
    const { steps } = drain(g.bankrupt(g.players[0]));
    expect(g.players[0].bankrupt).toBe(true);
    expect(g.players[0].whoPlays).toBe(0);
    expect(g.over).toEqual({ winner: -1, code: 1 });
    expect(steps.some((s: any) => s.t === 'bankrupt' && s.p === 0)).toBe(true);
  });

  it('includes un-airdropped players in 均富卡 and 命運#4/#5', () => {
    const g = new Game(makeSettings([
      { character: 0, human: true },
      { character: 1, human: false },
      { character: 2, human: false },
    ]), makeBoard());
    // Player 0 is placed; players 1 & 2 have NOT airdropped yet (placed = false).
    g.players[0].placed = true;
    g.players[0].node = 1;
    g.players[0].cash = 10000;
    g.players[1].cash = 20000;
    g.players[2].cash = 30000;

    // 均富卡 (card 1) should average across all 3 living players, including un-airdropped ones.
    g.players[0].cards = [1];
    drain((g.cards as any).play(g.players[0], 1, true));
    expect(g.players[0].cash).toBe(20000);
    expect(g.players[1].cash).toBe(20000);
    expect(g.players[2].cash).toBe(20000);

    // 命運 #4 (steal 10% of other living players' bank) should include un-airdropped players.
    g.players[0].bank = 10000;
    g.players[1].bank = 20000;
    g.players[2].bank = 30000;
    drain(g.events.applyFate(g.players[0], 4));
    expect(g.players[1].bank).toBe(18000);
    expect(g.players[2].bank).toBe(27000);
    expect(g.players[0].bank).toBe(15000);

    // 命運 #5 (birthday card gift) should include un-airdropped players.
    g.players[0].cards = [];
    g.players[1].cards = [2];
    g.players[2].cards = [3];
    drain(g.events.applyFate(g.players[0], 5));
    expect(g.players[0].cards).toEqual([2, 3]);
    expect(g.players[1].cards).toEqual([]);
    expect(g.players[2].cards).toEqual([]);
  });
});

describe('CARD-102: autoAnswer exhaustiveness and kb-machine tama preservation', () => {
  it('returns safe answers for all Ask variants', () => {
    const cases: [Ask, unknown][] = [
      [{ t: 'turn', p: 0, maxDice: 3, canUseCard: true, canUseTool: true }, { dice: 3 }],
      [{ t: 'auto-turn', p: 0 }, 0],
      [{ t: 'seat', p: 0 }, 0],
      [{ t: 'yesno', p: 0, kind: 'buy', text: 'buy?' }, false],
      [{ t: 'facility-type', p: 0, price: 1000 }, 1],
      [{ t: 'bank', p: 0, counter: true, maxLoan: 1000, canWithdraw: true, canBorrow: true }, -1],
      [{ t: 'choose', p: 0, title: 'pick', options: [{ label: 'a', value: 10 }], cancellable: true }, -1],
      [{ t: 'choose', p: 0, title: 'pick', options: [{ label: 'a', value: 10, disabled: true }, { label: 'b', value: 20 }], cancellable: false }, 20],
      [{ t: 'shop', p: 0, cards: [1], tools: [1], points: 100 }, -1],
      [{ t: 'mini-game', p: 0, game: 6 }, 60],
      [{ t: 'slot-machine', p: 0, god: 1, big: false }, 39],
      [{ t: 'wheel', p: 0, kind: 0, name: 'x', start: 0 }, 39],
      [{ t: 'lottery', p: 0, taken: [], pool: 1000, price: 100 }, -1],
      [{ t: 'black-market', p: 0 }, -1],
      [{ t: 'stock-market', p: 0 }, -1],
      [{ t: 'pick-node', p: 0, title: 'n', nodes: [1], cancellable: true }, 0],
      [{ t: 'pick-city-node', p: 0, title: 'cn', city: 0, nodes: [1], cancellable: true }, 0],
      [{ t: 'pick-map', p: 0, title: 'm', spots: [], cancellable: true }, -1],
      [{ t: 'pick-player', p: 0, title: 'p', players: [1], cancellable: true }, -1],
      [{ t: 'travel', p: 0, via: 'station', from: 'A', options: [] }, -1],
      [{ t: 'amount', p: 0, title: 'amt', min: 0, max: 100, step: 10 }, -1],
      [{ t: 'kb-machine', p: 0, kind: 'pachinko', maxBuys: 5, seed: 1, boost: false, stored: 1234, points: 500 }, { buys: 0, left: 1234 }],
      [{ t: 'kb-exchange', p: 0, kind: 'pachislot', left: 100, per: 5, value: 20, sale: false, options: [] }, { tools: [], store: false }],
      [{ t: 'kb-dice-keep', p: 0, values: [2, 5, 6], keep: 2 }, [0, 1]],
      [{ t: 'casino', p: 0, phase: 'choose', game: 'roulette', hall: '輪盤', banker: 1, facility: 0, name: 'H', level: 1, cap: 5000, min: 500, max: 5000, mult: 1, cash: 10000, fee: 100, godLine: '', free: false }, { game: 'roulette', stake: 500 }],
      [{ t: 'casino', p: 0, phase: 'blackjack', player: [10, 8], up: 6, canDouble: true, double: 500, stake: 500 }, 'stand'],
      [{ t: 'casino', p: 0, phase: 'holdem', hole: [1, 2], board: [3, 4, 5], stake: 500, call: 500 }, 'fold'],
    ];
    for (const [q, expected] of cases) {
      expect(autoAnswer(q)).toEqual(expected);
    }
  });
});

describe('CARD-103: core engine fixes', () => {
  it('exports unified FACILITY_MAX_LEVEL covering types 10..14', () => {
    expect(FACILITY_MAX_LEVEL.slice(0, 15)).toEqual([1, 5, 5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it('aggregates 5-city net dividends before bankruptcy in World.dividends()', () => {
    const boardWithCompany = (id: number, name: string, fundA: number): Board => ({
      ...makeBoard(),
      companies: [{ id, x: 0, y: 0, name, controller: 0, stockSlot: 0, category: 1, facing: 0, resource: 0, baseFee: 0, value: 0, freeShares: 0, fundA, fundB: 0 }],
    });
    const ts = tycoonSettings(0);
    const boards = ts.maps.map((_, i) =>
      i === 0 ? boardWithCompany(0, 'LossCo', -200_000)
        : i === 1 ? boardWithCompany(0, 'GainCo', 400_000)
          : makeBoard());
    const w = new World(ts, boards);
    const p = w.players[0];
    p.cash = 50_000;
    p.bank = 50_000; // total 100,000 < 200,000 loss in city 0, but net +200,000 across cities
    // Give player 0 all shares of stock 0 in city 0 and city 1.
    (w.cities[0].stocks as any).holdings[0][0].shares = 100;
    (w.cities[1].stocks as any).holdings[0][0].shares = 100;

    drain((w as any).dividends());
    expect(p.bankrupt).toBe(false);
    expect(p.bank).toBe(250_000);
    expect(p.cash).toBe(50_000);
  });

  it('uses finance.interestBase(p) in World.daily() monthly settlement', () => {
    const ts = tycoonSettings(0);
    const w = new World(ts, ts.maps.map(() => makeBoard()));
    w.cities[0].settings.fairFinance = true;
    const p = w.players[0];
    p.bank = 100_000;
    p.specialFinance = 60_000; // only 40,000 is interest-bearing under fairFinance
    p.loan = 0;

    const { steps } = drain((w as any).daily(true));
    const report = steps.find((s: any) => s.t === 'fx' && s.kind === 'month-report') as any;
    const row = report.data.rows.find((r: any) => r.p === p.id);
    expect(row.interest).toBe(4_000);
    expect(p.bank).toBe(104_000);
  });

  it('checks board prison node in events.fateCheck for 33..36', () => {
    const gWith = new Game(makeSettings([{ character: 0, human: true }, { character: 1, human: false }], { mapId: 4 }), makeBoard(8, true));
    expect(gWith.events.fateCheck(gWith.players[0], 33)).toBe(33);

    const gWithout = new Game(makeSettings([{ character: 0, human: true }, { character: 1, human: false }], { mapId: 0 }), makeBoard(8, false));
    expect(gWithout.events.fateCheck(gWithout.players[0], 33)).toBe(-1);
  });

  it('caps p.points at 0xffff and yields points events in RW06', () => {
    const g = new Game(makeSettings([{ character: 0, human: true }, { character: 1, human: false }]), makeBoard());
    const p = g.players[0], rival = g.players[1];
    p.placed = true; rival.placed = true;
    p.points = 0xfff0;
    rival.points = 100;
    // RW06 is index 5 in REWARDS? Let's invoke playReward with seq for RW06 (find its index or check)
    const { steps } = drain(playReward(g, p, 0, 'RW06', 1)); // n = 120
    expect(p.points).toBe(0xffff);
    expect(rival.points).toBe(0);
    expect(steps).toContainEqual({ t: 'points', p: rival.id, amount: -100 });
    expect(steps).toContainEqual({ t: 'points', p: p.id, amount: 0xffff - 0xfff0 });
  });

  it('randomFreeNode() falls back safely when all nodes are taken', () => {
    const g = new Game(makeSettings([{ character: 0, human: true }, { character: 1, human: false }]), makeBoard(4));
    for (let i = 0; i < 4; i++) {
      g.objects.slots.push({ type: 1, node: i + 1, dir: 0, life: 1, owner: 0 });
    }
    const n = g.randomFreeNode();
    expect(n).toBeDefined();
    expect(n.id).toBeGreaterThanOrEqual(1);
  });
});
