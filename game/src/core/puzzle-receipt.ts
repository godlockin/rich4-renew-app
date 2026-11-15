/**
 * Weekly Seed Puzzle (`CARD-303`) anti-tamper receipt generation & verification.
 * Uses a deterministic 32-bit FNV-1a integrity digest that works identically in browser and Node.
 */
import type { Game } from './game';
import type { PuzzleDef } from './puzzle';

export interface PuzzleReceipt {
  puzzleId: string;
  weekKey: string;
  seed: number;
  playerName: string;
  turns: number;
  finalAssets: number;
  stateHash: number;
  digest: string;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const DIGEST_RE = /^[0-9a-f]{8}$/;
const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

function fnv1aHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul((h ^ bytes[i]) >>> 0, FNV_PRIME) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function computeReceiptDigest(fields: Omit<PuzzleReceipt, 'digest'>): string {
  const canonical = [
    'rich4-puzzle-receipt-v1',
    fields.puzzleId,
    fields.weekKey,
    String(fields.seed),
    fields.playerName,
    String(fields.turns),
    String(fields.finalAssets),
    String(fields.stateHash >>> 0),
  ].join('|');
  return fnv1aHex(canonical);
}

/**
 * Computes the UTC ISO-8601 week key (e.g. `2026-W46`) for a given `Date`.
 */
export function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Creates a signed `PuzzleReceipt` for a completed puzzle run.
 */
export function createPuzzleReceipt(
  puzzle: PuzzleDef,
  g: Game,
  stateHash: number,
  playerName: string,
  date: Date = new Date(),
): PuzzleReceipt {
  const challenger = g.players[0];
  const cleanName = playerName.trim().slice(0, 32) || 'Anonymous';
  const base: Omit<PuzzleReceipt, 'digest'> = {
    puzzleId: puzzle.id,
    weekKey: getWeekKey(date),
    seed: puzzle.seed,
    playerName: cleanName,
    turns: g.daysElapsed,
    finalAssets: challenger ? g.wealth(challenger) : 0,
    stateHash: stateHash >>> 0,
  };
  return {
    ...base,
    digest: computeReceiptDigest(base),
  };
}

/**
 * Verifies the structural validity and FNV-1a integrity digest of a `PuzzleReceipt`.
 */
export function verifyPuzzleReceipt(receipt: PuzzleReceipt): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  if (typeof receipt.puzzleId !== 'string' || receipt.puzzleId.length === 0) return false;
  if (typeof receipt.weekKey !== 'string' || !WEEK_KEY_RE.test(receipt.weekKey)) return false;
  if (typeof receipt.seed !== 'number' || !Number.isFinite(receipt.seed)) return false;
  if (typeof receipt.playerName !== 'string' || receipt.playerName.trim().length === 0) return false;
  if (typeof receipt.turns !== 'number' || !Number.isInteger(receipt.turns) || receipt.turns < 0) return false;
  if (typeof receipt.finalAssets !== 'number' || !Number.isFinite(receipt.finalAssets)) return false;
  if (typeof receipt.stateHash !== 'number' || !Number.isInteger(receipt.stateHash) || receipt.stateHash < 0) return false;
  if (typeof receipt.digest !== 'string' || !DIGEST_RE.test(receipt.digest)) return false;

  return receipt.digest === computeReceiptDigest(receipt);
}
