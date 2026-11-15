import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { haveSimMaps, simMapFile, simMatch } from './ai-sim';
import { parseBoard, type Board, type RawMap } from './board';
import { pack } from './date';
import { Game, type WorldHooks } from './game';
import { loadGame, saveGame } from './save';
import { SmartAi } from './smart-ai';
import type { GameSettings, Player } from './types';

/**
 * The smarter computer (core/smart-ai.ts) and the computer's levels (Game.aiLevel): a normal game at its default
 * 簡單 never reaches it (and the golden runs of regional-golden.test.ts stay as they were); 中級 / 困難 are saved with
 * the game; a party plays it at 困難, the same from the same seed on every phone; and 簡單 < 中級 < 困難 (the long run:
 * `npx vite-node scripts/ai-sim.ts`).
 */
const MAPS = [0, 1, 100, 106];
const have = haveSimMaps(MAPS);

interface RunOpts { party?: boolean; human?: boolean; level?: 0 | 1 | 2 | 3; levels?: (0 | 1 | 2 | 3)[]; days?: number }

function newGame(mapId: number, seed: number, opts: RunOpts): Game {
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map((character, i) => ({ character, human: !!opts.human && i < 2 })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
    ...(opts.party ? { party: true } : {}), ...(opts.level !== undefined ? { aiLevel: opts.level } : {}),
  };
  const game = new Game(settings, board);
  game.animation = false;
  for (const p of game.players) if (p.human) p.autopilot = true;
  if (opts.levels) game.testLevels = opts.levels;
  return game;
}

/** Hash of every step and the final save of a game of `days` days; the first two seats humans on 托管 when `human`. */
function run(mapId: number, seed: number, opts: RunOpts): string {
  const game = newGame(mapId, seed, opts);
  const h = createHash('sha256'), flow = game.run();
  for (let r = flow.next(); !r.done && game.daysElapsed < (opts.days ?? 200); ) {
    h.update(JSON.stringify(r.value));
    const s = r.value as { ask?: boolean; t?: string };
    if ('ask' in s) { expect(s.t).toBe('auto-turn'); r = flow.next(0); } else r = flow.next();
  }
  const save = saveGame(game) as unknown as Record<string, unknown>;
  delete save.savedAt;
  h.update(JSON.stringify(save).replace(/,"aiLevel":0/, ''));
  return h.digest('hex').slice(0, 16);
}

describe.skipIf(!have)('the smarter computer and the computer levels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('簡單 (a normal game\'s default) never asks it: the same game, bit for bit, with or without aiLevel 0', () => {
    const spies = Object.getOwnPropertyNames(SmartAi.prototype).filter(k => k !== 'constructor')
      .map(k => vi.spyOn(SmartAi.prototype as unknown as Record<string, () => unknown>, k));
    for (const mapId of MAPS) {
      // Four computers, and two humans on 托管 with two computers.
      const plain = run(mapId, 9000 + mapId, {});
      expect(run(mapId, 9000 + mapId, { level: 0 })).toBe(plain);
      expect(run(mapId, 9000 + mapId, { levels: [0, 0, 0, 0] })).toBe(plain);
      expect(run(mapId, 77 + mapId, { human: true, level: 0 })).toBe(run(mapId, 77 + mapId, { human: true }));
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  }, 60_000);

  it('中級 and 困難 play differently, also humans on 托管, and the level is saved with the game', () => {
    const plain = run(1, 31, { human: true });
    const mid = run(1, 31, { human: true, level: 1 }), hard = run(1, 31, { human: true, level: 2 });
    expect(new Set([plain, mid, hard]).size).toBe(3);
    // Only the 托管 humans at 困難: their own level reaches them too.
    const g = newGame(1, 31, { human: true, level: 2 });
    for (const p of g.players) { p.whoPlays = p.human ? 1 : 2; p.autopilot = false; }
    expect(g.players.map(p => g.aiLevel(p))).toEqual([0, 0, 2, 2]); // humans playing by hand: none
    for (const p of g.players) p.autopilot = true;
    expect(g.players.map(p => g.aiLevel(p))).toEqual([2, 2, 2, 2]); // on 托管: the game's level
    const back = loadGame(JSON.parse(JSON.stringify(saveGame(newGame(1, 31, { level: 1 })))));
    expect(back.settings.aiLevel).toBe(1);
  }, 60_000);

  it('plays a party at the room\'s 電腦難度 (none: 困難), the same from the same seed (every phone)', () => {
    for (const mapId of [1, 106]) {
      const a = run(mapId, 4242, { party: true, human: true, days: 150 });
      expect(run(mapId, 4242, { party: true, human: true, days: 150 })).toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, level: 0, days: 150 })).not.toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, levels: [2, 2, 2, 2], days: 150 })).toBe(a);
      expect(run(mapId, 4242, { party: true, human: true, levels: [0, 0, 0, 0], days: 150 })).not.toBe(a);
    }
  }, 60_000);

  it('地獄難度動態威脅權重：優先針對威脅最高的真人，但也遏制滾雪球過大的電腦', () => {
    const g = newGame(1, 7, { party: true, human: true, level: 3 });
    const [h0, h1, c2, c3] = g.players;
    for (const p of g.players) p.whoPlays = p.human ? 1 : 2;
    h0.autopilot = false; h1.autopilot = false;
    // h1 資產略低於 c3（50萬 vs 60萬），但在 1.5x 真人威脅加權下（75萬 > 60萬）仍優先鎖定 h1
    Object.assign(c3, { cash: 600_000, bank: 0 }); Object.assign(h1, { cash: 500_000, bank: 0 }); Object.assign(h0, { cash: 100_000, bank: 0 });
    expect([g.aiLevel(c2), g.aiLevel(h0)]).toEqual([3, 0]);
    const ai = (g as unknown as { smart: { rival(p: unknown, q: unknown): boolean; leader(p: unknown): number } }).smart;
    expect([ai.rival(c2, h0), ai.rival(c2, h1), ai.rival(c2, c3)]).toEqual([true, true, true]);
    expect(ai.leader(c2)).toBe(h1.id);
    // 當 c3 資產遠超真人（900萬 > 75萬）時，地獄電腦也會轉頭遏制頭號威脅 c3
    Object.assign(c3, { cash: 9_000_000 });
    expect(ai.leader(c2)).toBe(c3.id);
    h1.autopilot = true;                              // a player on 托管 plays 困難, not with the gang
    expect(g.aiLevel(h1)).toBe(2);
  });

  it('簡單 < 中級 < 困難: two seats of one level against two of another', () => {
    const maps = [0, 1, 100], seeds = [1000, 1001, 1002];
    for (const [a, b] of [[1, 0], [2, 0], [2, 1]] as const) {
      const s = simMatch(maps, seeds, 365, a, b);
      expect(s.games).toBe(18);
      expect(s.aWins).toBeGreaterThan(s.bWins);
      expect(s.aWealth).toBeGreaterThan(s.bWealth);
    }
  }, 120_000);
});

function miniBoard(): Board {
  const N = 15;
  const nodes = [
    { id: 0, x: 0, y: 0, adjacent: [0, 0, 0, 0], oneWay: 0, dir: 0, ref: 0, event: 0, aux: 0, noDrop: true },
    ...Array.from({ length: N }, (_, k) => {
      const id = k + 1;
      return {
        id, x: 100 + k * 20, y: 100, adjacent: [id < N ? id + 1 : 1, 0, id > 1 ? id - 1 : N, 0],
        oneWay: 0, dir: 0, ref: id === 2 ? 2001 : 0, event: 0, aux: 0, noDrop: false,
      };
    }),
  ];
  const lands = [{
    id: 1, name: 'TestSt', x: 120, y: 100, price: 2000, perLevel: 1000,
    tolls: [200, 600, 1400, 3000, 6000, 10000], owner: 1, level: 0, chain: false, shop: 0,
    tmpState: 0, facing: 0, lastToll: 0, expire: 0,
  }];
  return { name: 'Mini', mapId: 0, nodes, lands, facilities: [], companies: [], landscapes: [] };
}

function miniGame(aiLevel: 0 | 1 | 2 | 3 = 2, hooks?: WorldHooks, rules?: Game['rules']): Game {
  const settings: GameSettings = {
    mapId: 0, players: [{ character: 0, human: false }, { character: 1, human: false }],
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0,
    startDate: pack(2026, 10, 14), seed: 1, aiLevel,
  };
  const base = new Game(settings, miniBoard());
  const g = hooks ? new Game(settings, base.board, { index: 0, hooks, players: base.players }) : base;
  if (rules) Object.assign(g, { rules });
  g.animation = false;
  g.players[0].node = 1; g.players[0].lastNode = 15; g.players[0].placed = true;
  g.players[1].node = 3; g.players[1].lastNode = 2; g.players[1].placed = true;
  for (const q of g.players) { q.whoPlays = 2; q.cards = []; q.tools.fill(0); }
  return g;
}

describe('SmartAi Daimillionaire cards/tools & Kabukicho rampage (CARD-104)', () => {
  it('plays Kabukicho KB_RAMPAGE (38) via g.rules.aiPlayCard at aiLevel >= 2', () => {
    let played = false;
    const g = miniGame(2, undefined, {
      ownCards: [38],
      aiPlayCard: (_game, player, id) => player.id === 0 && id === 38,
      *playCard(_game, player, id) { if (player.id === 0 && id === 38) { played = true; return true; } return false; },
    });
    const p = g.players[0];
    p.cards = [38];
    const acts = g.smart.actions(p);
    expect(acts.length).toBeGreaterThan(0);
    const flow = acts[0].run();
    for (let r = flow.next(); !r.done; r = flow.next());
    expect(played).toBe(true);
  });

  it('scores and uses Daimillionaire cards 31..36 and 39 when in world mode', () => {
    const calls: string[] = [];
    const hooks = {
      wealth: (q: Player) => q.cash + q.bank,
      bankrupt: function* () {},
      travelSquare: function* () { return false; },
      overflow: function* () { return false; },
      bankOperators: () => [],
      cityOf: () => g,
      humanMarket: function* () {},
      allCities: () => [g],
      travelCard: function* (_g: Game, _p: Player, via: string, dest?: number) { calls.push(`travel:${via}:${dest}`); return true; },
      aiCardTrip: (_g: Game, _p: Player, via: string) => { calls.push(`aiTrip:${via}`); return 1; },
      deport: function* (_g: Game, victim: Player) { calls.push(`deport:${victim.id}`); return true; },
      dictateVictims: () => [g.players[1]],
      dictate: function* () { calls.push('dictate'); },
      aiDictate: () => true,
      summonable: () => [g.players[1]],
      summon: function* () { calls.push('summon'); },
      aiSummon: () => true,
      wantedOptions: () => [{ label: 'Rival', value: g.players[1].id, disabled: false }],
      wanted: function* (_g: Game, _p: Player, q: Player) { calls.push(`wanted:${q.id}`); },
      wantedUsed: () => {},
      aiWanted: () => g.players[1].id,
      icbm: function* () {},
      aiIcbm: () => -1,
      spaceTime: function* () {},
      aiSpaceTime: () => -1,
    } as unknown as WorldHooks;
    const g = miniGame(2, hooks);
    const p = g.players[0], rival = g.players[1];
    rival.cash = 500_000;

    for (const id of [31, 32, 33, 34, 35, 36] as const) {
      p.cards = [id];
      const acts = g.smart.actions(p);
      expect(acts.length).toBeGreaterThan(0);
      const fl = acts[0].run();
      for (let r = fl.next(); !r.done; r = fl.next());
    }
    expect(calls).toContain('travel:airport:1');
    expect(calls).toContain('travel:station:1');
    expect(calls).toContain(`deport:${rival.id}`);
    expect(calls).toContain('dictate');
    expect(calls).toContain('summon');
    expect(calls).toContain(`wanted:${rival.id}`);

    // 39 複製卡: should score higher than the card it copies and duplicate it
    p.cards = [39, 34];
    const best = g.smart.actions(p).sort((a, b) => b.score - a.score)[0];
    const fl = best.run();
    for (let r = fl.next(); !r.done; r = fl.next());
    expect(p.cards.filter(c => c === 34).length).toBe(2);
    expect(p.cards).not.toContain(39);
  });

  it('scores and uses Daimillionaire lab tools 14..16 when in world mode', () => {
    const calls: string[] = [];
    const hooks = {
      wealth: (q: Player) => q.cash + q.bank,
      icbm: function* (_g: Game, _p: Player, city: number, target: number) { calls.push(`icbm:${city}:${target}`); },
      aiIcbm: () => 10005,
      spaceTimeCities: () => [{ label: 'City1', value: 1, disabled: false }],
      spaceTime: function* (_g: Game, _p: Player, city: number) { calls.push(`spaceTime:${city}`); },
      aiSpaceTime: () => 1,
    } as unknown as WorldHooks;
    const g = miniGame(2, hooks);
    const p = g.players[0];

    // Tool 14: 超級工人 upgrades owned land by +2 levels
    p.tools[13] = 1;
    const t14 = g.smart.actions(p);
    expect(t14.length).toBeGreaterThan(0);
    for (let fl = t14[0].run(), r = fl.next(); !r.done; r = fl.next());
    expect(g.board.lands[0].level).toBe(2);
    expect(p.tools[13]).toBe(0);

    // Tool 15: 洲際飛彈
    p.tools[14] = 1;
    const t15 = g.smart.actions(p);
    expect(t15.length).toBeGreaterThan(0);
    for (let fl = t15[0].run(), r = fl.next(); !r.done; r = fl.next());
    expect(calls).toContain('icbm:1:5');
    expect(p.tools[14]).toBe(0);

    // Tool 16: 時空機
    p.tools[15] = 1;
    const t16 = g.smart.actions(p);
    expect(t16.length).toBeGreaterThan(0);
    for (let fl = t16[0].run(), r = fl.next(); !r.done; r = fl.next());
    expect(calls).toContain('spaceTime:1');
    expect(p.tools[15]).toBe(0);
  });
});
