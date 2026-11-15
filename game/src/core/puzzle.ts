/**
 * Weekly Seed Puzzle (`CARD-303`):
 * Curated deterministic comeback puzzles with fixed seeds, pre-configured board/player states,
 * and win/loss evaluation within `maxDays` turns.
 */
import type { Board } from './board';
import { pack } from './date';
import { Game } from './game';
import type { GameSettings } from './types';

export interface PuzzlePlayerSetup {
  character: number;
  human: boolean;
  cash?: number;
  bank?: number;
  loan?: number;
  points?: number;
  /** Optional starting node id on the board; when present, places the player deterministically. */
  nodeId?: number;
  /** Initial card ids in hand. */
  cards?: number[];
  /** Initial tool counts keyed by 1-based tool id. */
  tools?: Partial<Record<number, number>>;
  /** Board land indices (0-based into `board.lands`) owned at puzzle start. */
  lands?: { index: number; level?: number }[];
}

export interface PuzzleDef {
  id: string;
  title: string;
  description: string;
  seed: number;
  mapId: number;
  maxDays: number;
  goal: {
    targetWealth?: number;
    bankruptAllOpponents?: boolean;
  };
  settings?: Partial<Omit<GameSettings, 'mapId' | 'seed' | 'players'>>;
  players: PuzzlePlayerSetup[];
}

export type PuzzleStatus = 'won' | 'lost' | 'in-progress';

export interface PuzzleEvaluation {
  status: PuzzleStatus;
  daysElapsed: number;
  maxDays: number;
  playerWealth: number;
  targetWealth?: number;
  opponentsRemaining: number;
  reason: string;
}

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: 'comeback-debt-turnaround',
    title: '絕地反攻：負債逆轉',
    description: '開局現金吃緊且對手領先，利用手牌與地產升級在 30 天內將總資產推升至 120,000 元。',
    seed: 20261101,
    mapId: 0,
    maxDays: 30,
    goal: { targetWealth: 120000 },
    settings: { fundIndex: 3, traits: true, aiLevel: 1 },
    players: [
      {
        character: 4, // 阿土伯
        human: true,
        cash: 15000,
        bank: 5000,
        points: 80,
        cards: [1, 14, 29], // 購地卡、均富卡、查封卡
        tools: { 5: 1 }, // 機車
        lands: [{ index: 0, level: 2 }, { index: 1, level: 1 }],
      },
      {
        character: 1, // 沙隆巴斯
        human: false,
        cash: 45000,
        bank: 40000,
        points: 40,
        lands: [{ index: 2, level: 3 }, { index: 3, level: 2 }],
      },
    ],
  },
  {
    id: 'comeback-bankrupt-tycoon',
    title: '扳倒地產大亨',
    description: '對手資金見底卻坐擁高級地產，在 25 天內迫使所有對手破產！',
    seed: 20261108,
    mapId: 0,
    maxDays: 25,
    goal: { bankruptAllOpponents: true },
    settings: { fundIndex: 4, aiLevel: 1 },
    players: [
      {
        character: 9, // 孫小美
        human: true,
        cash: 40000,
        bank: 20000,
        points: 100,
        cards: [27, 29, 31], // 查稅卡、查封卡、烏龜卡
        tools: { 1: 1, 7: 1 }, // 遙控骰子、路障
        lands: [{ index: 0, level: 3 }],
      },
      {
        character: 0, // 約翰喬
        human: false,
        cash: 3000,
        bank: 2000,
        points: 0,
        lands: [{ index: 2, level: 2 }],
      },
    ],
  },
  {
    id: 'comeback-sprint-wealth',
    title: '限時致富衝刺',
    description: '僅有 15 天時間，善用錢夫人的理財特性與既有存款，達成 150,000 元淨資產目標。',
    seed: 20261115,
    mapId: 0,
    maxDays: 15,
    goal: { targetWealth: 150000 },
    settings: { fundIndex: 2, traits: true, startDate: pack(2026, 11, 25) },
    players: [
      {
        character: 3, // 錢夫人
        human: true,
        cash: 25000,
        bank: 90000,
        points: 60,
        cards: [18, 28], // 紅卡、漲價卡
        lands: [{ index: 0, level: 2 }],
      },
      {
        character: 6, // 宮本寶藏
        human: false,
        cash: 50000,
        bank: 50000,
        points: 30,
        lands: [{ index: 1, level: 2 }],
      },
    ],
  },
  {
    id: 'comeback-two-front-war',
    title: '雙雄夾擊突圍戰',
    description: '面對兩位富豪對手的夾擊，在 35 天內達成 180,000 元總資產並讓對手全數破產。',
    seed: 20261122,
    mapId: 0,
    maxDays: 35,
    goal: { targetWealth: 180000, bankruptAllOpponents: true },
    settings: { fundIndex: 2, traits: true, aiLevel: 2 },
    players: [
      {
        character: 2, // 忍太郎
        human: true,
        cash: 35000,
        bank: 30000,
        points: 120,
        tools: { 5: 1, 1: 1 }, // 機車、遙控骰子
        cards: [14, 29, 31],
        lands: [{ index: 0, level: 3 }, { index: 1, level: 2 }],
      },
      {
        character: 5, // 莎拉公主
        human: false,
        cash: 12000,
        bank: 10000,
        points: 10,
      },
      {
        character: 10, // 小丹尼
        human: false,
        cash: 10000,
        bank: 8000,
        points: 10,
      },
    ],
  },
];

/** Deterministically selects a weekly puzzle based on the ISO week of `date`. */
export function getWeeklyPuzzle(date: Date = new Date()): PuzzleDef {
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const weekIndex = Math.floor(utc / (7 * 24 * 60 * 60 * 1000));
  return PUZZLES[((weekIndex % PUZZLES.length) + PUZZLES.length) % PUZZLES.length];
}

/** Creates a deterministic `Game` initialized to the given `PuzzleDef` and `Board`. */
export function createPuzzleGame(puzzle: PuzzleDef, board: Board): Game {
  const settings: GameSettings = {
    mapId: puzzle.mapId,
    players: puzzle.players.map(p => ({ character: p.character, human: p.human })),
    fundIndex: puzzle.settings?.fundIndex ?? 3,
    traffic: puzzle.settings?.traffic ?? 0,
    landLimitIndex: puzzle.settings?.landLimitIndex ?? 0,
    daysLimitIndex: puzzle.settings?.daysLimitIndex ?? 0,
    victoryIndex: puzzle.settings?.victoryIndex ?? 0,
    startDate: puzzle.settings?.startDate ?? pack(2026, 11, 1),
    seed: puzzle.seed,
    ...puzzle.settings,
  };
  const g = new Game(settings, board);

  puzzle.players.forEach((setup, idx) => {
    const p = g.players[idx];
    if (!p) return;
    if (setup.cash !== undefined) p.cash = setup.cash;
    if (setup.bank !== undefined) p.bank = setup.bank;
    if (setup.loan !== undefined) p.loan = setup.loan;
    if (setup.points !== undefined) p.points = setup.points;
    if (setup.cards !== undefined) p.cards = [...setup.cards];
    if (setup.tools) {
      for (const [toolIdStr, count] of Object.entries(setup.tools)) {
        const toolId = Number(toolIdStr);
        if (toolId >= 1 && toolId <= p.tools.length && typeof count === 'number') {
          p.tools[toolId - 1] = Math.max(0, count);
        }
      }
    }
    if (setup.lands) {
      for (const l of setup.lands) {
        const land = g.board.lands[l.index];
        if (!land) continue;
        land.owner = idx + 1;
        land.expire = 0;
        if (l.level !== undefined) land.level = l.level;
      }
    }
    if (setup.nodeId !== undefined) {
      const node = g.board.nodes.find(n => n.id === setup.nodeId);
      if (node) {
        p.node = node.id;
        p.lastNode = node.adjacent.find(Boolean) ?? node.id;
        p.placed = true;
        p.whoPlays = p.human ? 1 : 2;
      }
    }
  });

  return g;
}

/** Evaluates whether the challenger (player 0) has won, lost, or is still in progress. */
export function evaluatePuzzle(g: Game, puzzle: PuzzleDef): PuzzleEvaluation {
  const challenger = g.players[0];
  const playerWealth = challenger ? g.wealth(challenger) : 0;
  const opponentsRemaining = g.players.slice(1).filter(p => !p.bankrupt && p.whoPlays !== 0).length;

  if (!challenger || challenger.bankrupt || !challenger.whoPlays) {
    return {
      status: 'lost',
      daysElapsed: g.daysElapsed,
      maxDays: puzzle.maxDays,
      playerWealth,
      targetWealth: puzzle.goal.targetWealth,
      opponentsRemaining,
      reason: '玩家已破產或敗北',
    };
  }

  const wealthMet = puzzle.goal.targetWealth === undefined || playerWealth >= puzzle.goal.targetWealth;
  const bankruptMet = !puzzle.goal.bankruptAllOpponents || opponentsRemaining === 0;

  if (wealthMet && bankruptMet && g.daysElapsed <= puzzle.maxDays) {
    return {
      status: 'won',
      daysElapsed: g.daysElapsed,
      maxDays: puzzle.maxDays,
      playerWealth,
      targetWealth: puzzle.goal.targetWealth,
      opponentsRemaining,
      reason: '達成殘局目標！',
    };
  }

  if (g.daysElapsed > puzzle.maxDays || g.over) {
    return {
      status: 'lost',
      daysElapsed: g.daysElapsed,
      maxDays: puzzle.maxDays,
      playerWealth,
      targetWealth: puzzle.goal.targetWealth,
      opponentsRemaining,
      reason: '超過限制天數仍未達成目標',
    };
  }

  return {
    status: 'in-progress',
    daysElapsed: g.daysElapsed,
    maxDays: puzzle.maxDays,
    playerWealth,
    targetWealth: puzzle.goal.targetWealth,
    opponentsRemaining,
    reason: '挑戰進行中',
  };
}
