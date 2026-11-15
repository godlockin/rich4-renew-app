import { describe, expect, it } from 'vitest';
import type { Board, BoardNode, Land } from './board';
import { createPuzzleGame, evaluatePuzzle, getWeeklyPuzzle, PUZZLES, type PuzzleDef } from './puzzle';
import { saveGame } from './save';

function makePuzzleBoard(): Board {
  const nodes: BoardNode[] = [];
  for (let i = 1; i <= 8; i++) {
    const prev = i === 1 ? 8 : i - 1;
    const next = i === 8 ? 1 : i + 1;
    nodes.push({
      id: i,
      x: i * 100,
      y: 100,
      adjacent: [next, prev, 0, 0],
      ref: i <= 4 ? 2000 + i : 0,
      aux: 0,
      event: 0,
      oneWay: 0,
      noDrop: false,
    });
  }
  const lands: Land[] = [1, 2, 3, 4].map(id => ({
    id,
    x: id * 100,
    y: 100,
    name: `殘局街${id}`,
    tmpState: 0,
    chain: false,
    owner: 0,
    level: 0,
    facing: 0,
    price: 5000,
    perLevel: 2500,
    tolls: [1000, 2000, 4000, 8000, 12000, 20000],
    lastToll: 0,
    expire: 0,
  }));
  return {
    name: 'PuzzleTestBoard',
    mapId: 0,
    nodes,
    lands,
    facilities: [],
    companies: [],
    landscapes: [],
  };
}

describe('Weekly Seed Puzzle (puzzle.ts)', () => {
  it('defines a curated set of puzzles with unique IDs and valid goals', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(PUZZLES.map(p => p.id));
    expect(ids.size).toBe(PUZZLES.length);
    for (const p of PUZZLES) {
      expect(p.maxDays).toBeGreaterThan(0);
      expect(p.players.length).toBeGreaterThanOrEqual(2);
      expect(p.goal.targetWealth !== undefined || p.goal.bankruptAllOpponents).toBe(true);
    }
  });

  it('selects weekly puzzles deterministically by date', () => {
    const d1 = new Date('2026-11-15T00:00:00Z');
    const d2 = new Date('2026-11-15T12:00:00Z');
    expect(getWeeklyPuzzle(d1).id).toBe(getWeeklyPuzzle(d2).id);
  });

  it('creates deterministic game state from PuzzleDef', () => {
    const puzzle = PUZZLES[0];
    const g1 = createPuzzleGame(puzzle, makePuzzleBoard());
    const g2 = createPuzzleGame(puzzle, makePuzzleBoard());

    const s1 = saveGame(g1);
    const s2 = saveGame(g2);
    s1.savedAt = 0;
    s2.savedAt = 0;
    expect(s1).toEqual(s2);

    expect(g1.players[0].cash).toBe(puzzle.players[0].cash);
    expect(g1.players[0].bank).toBe(puzzle.players[0].bank);
    expect(g1.players[0].cards).toEqual(puzzle.players[0].cards);
    expect(g1.board.lands[0].owner).toBe(1);
    expect(g1.board.lands[0].level).toBe(2);
  });

  it('evaluates targetWealth win, timeout loss, and player bankruptcy loss', () => {
    const puzzle: PuzzleDef = {
      id: 'test-wealth',
      title: 'Test Wealth',
      description: 'Reach 100k in 10 days',
      seed: 100,
      mapId: 0,
      maxDays: 10,
      goal: { targetWealth: 100000 },
      players: [
        { character: 4, human: true, cash: 20000, bank: 20000 },
        { character: 1, human: false, cash: 50000, bank: 50000 },
      ],
    };

    const g = createPuzzleGame(puzzle, makePuzzleBoard());
    expect(evaluatePuzzle(g, puzzle).status).toBe('in-progress');

    // Meet target wealth within maxDays
    g.daysElapsed = 5;
    g.players[0].cash = 100000;
    const won = evaluatePuzzle(g, puzzle);
    expect(won.status).toBe('won');
    expect(won.playerWealth).toBeGreaterThanOrEqual(100000);

    // Exceed maxDays without meeting target
    g.players[0].cash = 10000;
    g.daysElapsed = 11;
    expect(evaluatePuzzle(g, puzzle).status).toBe('lost');

    // Challenger bankrupt
    g.daysElapsed = 3;
    g.players[0].bankrupt = true;
    expect(evaluatePuzzle(g, puzzle).status).toBe('lost');
  });

  it('evaluates bankruptAllOpponents goal correctly', () => {
    const puzzle = PUZZLES.find(p => p.goal.bankruptAllOpponents && !p.goal.targetWealth)!;
    const g = createPuzzleGame(puzzle, makePuzzleBoard());

    expect(evaluatePuzzle(g, puzzle).status).toBe('in-progress');
    expect(evaluatePuzzle(g, puzzle).opponentsRemaining).toBe(1);

    g.players[1].bankrupt = true;
    g.players[1].whoPlays = 0;
    const res = evaluatePuzzle(g, puzzle);
    expect(res.status).toBe('won');
    expect(res.opponentsRemaining).toBe(0);
  });
});
