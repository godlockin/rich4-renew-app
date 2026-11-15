import { describe, expect, it } from 'vitest';
import type { Board, BoardNode, Land } from './board';
import { createPuzzleGame, PUZZLES } from './puzzle';
import { createPuzzleReceipt, getWeekKey, verifyPuzzleReceipt } from './puzzle-receipt';
import { computeStateHash } from './state-hash';

function makeBoard(): Board {
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
    name: 'ReceiptTestBoard',
    mapId: 0,
    nodes,
    lands,
    facilities: [],
    companies: [],
    landscapes: [],
  };
}

describe('Puzzle anti-tamper receipt (puzzle-receipt.ts)', () => {
  it('computes ISO week keys deterministically', () => {
    expect(getWeekKey(new Date('2026-11-15T12:00:00Z'))).toBe('2026-W46');
    expect(getWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });

  it('generates and verifies a valid puzzle receipt', () => {
    const puzzle = PUZZLES[0];
    const g = createPuzzleGame(puzzle, makeBoard());
    g.daysElapsed = 12;
    g.players[0].cash = 135000;
    const stateHash = computeStateHash(g);
    const fixedDate = new Date('2026-11-15T12:00:00Z');

    const receipt = createPuzzleReceipt(puzzle, g, stateHash, '阿土伯', fixedDate);

    expect(receipt.puzzleId).toBe(puzzle.id);
    expect(receipt.weekKey).toBe('2026-W46');
    expect(receipt.seed).toBe(puzzle.seed);
    expect(receipt.playerName).toBe('阿土伯');
    expect(receipt.turns).toBe(12);
    expect(receipt.finalAssets).toBe(g.wealth(g.players[0]));
    expect(receipt.stateHash).toBe(stateHash >>> 0);
    expect(receipt.digest).toMatch(/^[0-9a-f]{8}$/);
    expect(verifyPuzzleReceipt(receipt)).toBe(true);
  });

  it('detects tampering on turns, finalAssets, stateHash, or puzzleId', () => {
    const puzzle = PUZZLES[0];
    const g = createPuzzleGame(puzzle, makeBoard());
    g.daysElapsed = 10;
    const stateHash = computeStateHash(g);
    const receipt = createPuzzleReceipt(puzzle, g, stateHash, 'Tester', new Date('2026-11-15T00:00:00Z'));

    expect(verifyPuzzleReceipt(receipt)).toBe(true);
    expect(verifyPuzzleReceipt({ ...receipt, turns: receipt.turns - 1 })).toBe(false);
    expect(verifyPuzzleReceipt({ ...receipt, finalAssets: receipt.finalAssets + 50000 })).toBe(false);
    expect(verifyPuzzleReceipt({ ...receipt, stateHash: (receipt.stateHash ^ 1) >>> 0 })).toBe(false);
    expect(verifyPuzzleReceipt({ ...receipt, puzzleId: 'tampered-puzzle' })).toBe(false);
  });
});
