import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import {
  EV_PK, LIVE_FATE, LIVE_MAP, LIVE_NEWS, LIVE_NORMAL_FATE, LIVE_STREAMER_TASKS,
  LIVE_VIEWER_RULES, LiveCityRules, PK_STAKE, TASK_PENALTY_CASH, TASK_REWARD_POINTS, liveRules,
} from './live-city';
import { loadGame, saveGame } from './save';
import type { GameSettings, Step } from './types';

const mapFile = fileURLToPath(new URL('../../public/assets/maps/remake/live-city.json', import.meta.url));
const rawMap = () => JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap;
const board = () => parseBoard(rawMap());

function settings(seed: number, humanFirst = false): GameSettings {
  return {
    mapId: LIVE_MAP,
    players: [0, 4, 9, 11].map((character, idx) => ({ character, human: humanFirst && idx === 0 })),
    fundIndex: 1,
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate: pack(2026, 11, 15),
    seed,
  };
}

function drain<T>(f: Generator<unknown, T, unknown>, answer?: boolean): { value: T; out: Step[] } {
  const out: Step[] = [];
  let r = f.next();
  while (!r.done) {
    const step = r.value as Step;
    out.push(step);
    r = f.next('ask' in step && step.ask ? answer : undefined);
  }
  return { value: r.value, out };
}

function runDays(g: Game, days: number, see?: (s: Step) => void): void {
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) {
    see?.(r.value as Step);
  }
}

describe('直播市區 (map 108)', () => {
  it('board matches 6-island layout: 181 nodes, 72 lands, 8 facilities, 6 companies, 12 stocks', () => {
    const b = board();
    expect(b.mapId).toBe(108);
    expect(b.name).toBe('直播市區');
    expect(b.size).toBe(2304);
    expect(b.nodes).toHaveLength(181);
    expect(b.lands).toHaveLength(72);
    expect(b.facilities).toHaveLength(8);
    expect(b.companies).toHaveLength(6);
    expect(b.stockNames).toHaveLength(12);
    expect(b.stockNames?.slice(0, 6)).toEqual([
      '家人們MCN', '閃送外賣', '甜心奶茶', '飛速快遞', '像素遊戲', '大屏手機',
    ]);
  });

  it('event counts and spacing invariants match docs/rules/25-live-city.md', () => {
    const b = board();
    const byEv = (ev: number) => b.nodes.filter(n => n.event === ev);
    expect(byEv(3)).toHaveLength(11);  // 直播間
    expect(byEv(2)).toHaveLength(3);   // 上熱搜
    expect(byEv(EV_PK)).toHaveLength(2); // 連麥 PK
    expect(byEv(9)).toHaveLength(2);   // 抽獎直播間
    expect(byEv(13)).toHaveLength(2);  // 周邊店
    expect(byEv(15)).toHaveLength(3);  // 設備店
    expect(byEv(16)).toHaveLength(1);  // 玄學直播間
    expect(byEv(10)).toHaveLength(1);  // 流量 +50
    expect(byEv(11)).toHaveLength(1);  // 流量 +30
    expect(byEv(12)).toHaveLength(1);  // 流量 +10
    expect(byEv(6)).toHaveLength(1);   // 七彩氣球
    expect(byEv(7)).toHaveLength(1);   // 喜從天降
    expect(byEv(5)).toHaveLength(1);   // 醫院
    expect(byEv(14)).toHaveLength(2);  // 銀行
    expect(byEv(4)).toHaveLength(1);   // 小黑屋

    // One-way 彈幕大橋 exists
    expect(b.nodes.some(n => n.oneWay !== 0)).toBe(true);

    // No two event nodes are adjacent
    const nodeMap = new Map(b.nodes.map(n => [n.id, n]));
    for (const n of b.nodes) {
      if (n.event === 0) continue;
      for (const nbId of n.adjacent) {
        if (!nbId) continue;
        expect(nodeMap.get(nbId)!.event, `adjacent events ${n.id} & ${nbId}`).toBe(0);
      }
    }

    // All 直播間 (event 3) nodes are >= 8 BFS steps apart
    const fateNodes = byEv(3).map(n => n.id);
    for (const start of fateNodes) {
      const dist = new Map<number, number>([[start, 0]]);
      const q = [start];
      while (q.length) {
        const u = q.shift()!;
        for (const v of nodeMap.get(u)!.adjacent) {
          if (v && !dist.has(v)) {
            dist.set(v, dist.get(u)! + 1);
            q.push(v);
          }
        }
      }
      for (const other of fateNodes) {
        if (other !== start) expect(dist.get(other)!, `fate ${start} to ${other}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('tables: 24 news, 24 normal fate, 24 streamer tasks, 10 viewer rules', () => {
    expect(LIVE_NEWS).toHaveLength(24);
    expect(LIVE_NORMAL_FATE).toHaveLength(24);
    expect(LIVE_STREAMER_TASKS).toHaveLength(24);
    expect(LIVE_FATE).toHaveLength(48);
    expect(LIVE_VIEWER_RULES).toHaveLength(10);
  });

  it('連麥 PK: visitor and nearest opponent roll dice; lower roll pays 2000 * priceIndex', () => {
    const g = new Game(settings(42), board());
    const rules = liveRules(g)!;
    expect(rules).toBeInstanceOf(LiveCityRules);

    const pkNode = g.board.nodes.find(n => n.event === EV_PK)!;
    for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cash = 50000; q.bank = 50000; }
    const [p0, p1, p2, p3] = g.players;
    p0.node = pkNode.id;
    // Place p1 right next to pkNode, p2/p3 farther away
    const nearId = pkNode.adjacent.find(id => id > 0)!;
    p1.node = nearId;
    p2.node = 1;
    p3.node = 20;

    const p0Before = p0.cash + p0.bank;
    const p1Before = p1.cash + p1.bank;
    const { out } = drain(rules.landSquare(g, p0, pkNode));
    const pkFx = out.find((s): s is Extract<Step, { t: 'fx' }> => s.t === 'fx' && s.kind === 'live-pk');
    expect(pkFx).toBeDefined();
    const data = pkFx!.data as { opponent: number; myRoll: number; oppRoll: number; amount: number };
    expect(data.opponent).toBe(p1.id);
    if (data.myRoll === data.oppRoll) {
      expect(data.amount).toBe(0);
      expect(p0.cash + p0.bank).toBe(p0Before);
      expect(p1.cash + p1.bank).toBe(p1Before);
    } else if (data.myRoll < data.oppRoll) {
      expect(p0Before - (p0.cash + p0.bank)).toBe(PK_STAKE * g.priceIndex);
      expect((p1.cash + p1.bank) - p1Before).toBe(PK_STAKE * g.priceIndex);
    } else {
      expect((p0.cash + p0.bank) - p0Before).toBe(PK_STAKE * g.priceIndex);
      expect(p1Before - (p1.cash + p1.bank)).toBe(PK_STAKE * g.priceIndex);
    }
  });

  it('streamer tasks: computers never draw tasks; humans get +30 pts on complete and -3000 cash on refuse', () => {
    const g = new Game(settings(7, true), board());
    const rules = liveRules(g)!;
    const [human, ai] = g.players;
    for (const q of g.players) { q.placed = true; q.cash = 50000; q.bank = 50000; q.points = 10; }

    // AI draws 10 times: never triggers live-streamer-task
    for (let i = 0; i < 10; i++) {
      const { out } = drain(rules.fate(g, ai));
      expect(out.some(s => s.t === 'fx' && s.kind === 'live-streamer-task')).toBe(false);
    }

    // Human draws a specific streamer task: complete -> +30 points
    const ptsBefore = human.points;
    const doneRes = drain(rules.runStreamerTask(g, human, LIVE_STREAMER_TASKS[0]), true);
    expect(doneRes.out.some(s => s.t === 'fx' && s.kind === 'live-streamer-task')).toBe(true);
    expect(doneRes.out.some(s => s.t === 'yesno' && s.kind === 'live-task')).toBe(true);
    expect(human.points).toBe(ptsBefore + TASK_REWARD_POINTS);
    expect(rules.s.lastTask?.cardId).toBe(LIVE_STREAMER_TASKS[0].id);

    // Human refuses -> -3000 * priceIndex
    const totalBefore = human.cash + human.bank;
    drain(rules.runStreamerTask(g, human, LIVE_STREAMER_TASKS[1]), false);
    expect(totalBefore - (human.cash + human.bank)).toBe(TASK_PENALTY_CASH * g.priceIndex);

    // With streamerTasksEnabled = false, human also skips tasks
    rules.s.streamerTasksEnabled = false;
    for (let i = 0; i < 10; i++) {
      const { out } = drain(rules.fate(g, human));
      expect(out.some(s => s.t === 'fx' && s.kind === 'live-streamer-task')).toBe(false);
    }
  });

  it('save/load preserves LiveState and 60-day AI simulation runs cleanly', () => {
    const g = new Game(settings(99), board());
    const rules = liveRules(g)!;
    rules.s.streamerTasksEnabled = false;
    let newsCount = 0;
    let fateCount = 0;
    runDays(g, 60, s => {
      if (s.t === 'fx' && s.kind === 'news') newsCount++;
      if (s.t === 'fx' && s.kind === 'fate') fateCount++;
    });
    expect(newsCount + fateCount).toBeGreaterThan(0);

    const saved = saveGame(g);
    const g2 = loadGame(saved, board());
    const rules2 = liveRules(g2)!;
    expect(rules2.s.streamerTasksEnabled).toBe(false);
    expect(rules2.s.news.deck).toEqual(rules.s.news.deck);
    expect(rules2.s.fate.deck).toEqual(rules.s.fate.deck);
  }, 60_000);
});
