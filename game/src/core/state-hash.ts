/**
 * Lightweight 32-bit FNV-1a full-state hash for party-mode lockstep desync detection.
 * Covers rng seed, player states, board lands/facilities, stocks, and map objects.
 */
import type { Game } from './game';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const _buf = new ArrayBuffer(8);
const _dv = new DataView(_buf);

function mixU32(h: number, v: number): number {
  const u = v >>> 0;
  h = Math.imul((h ^ (u & 0xff)) >>> 0, FNV_PRIME) >>> 0;
  h = Math.imul((h ^ ((u >>> 8) & 0xff)) >>> 0, FNV_PRIME) >>> 0;
  h = Math.imul((h ^ ((u >>> 16) & 0xff)) >>> 0, FNV_PRIME) >>> 0;
  h = Math.imul((h ^ ((u >>> 24) & 0xff)) >>> 0, FNV_PRIME) >>> 0;
  return h;
}

function mixNum(h: number, v: number): number {
  if (Number.isInteger(v) && v >= -0x80000000 && v <= 0xffffffff) {
    return mixU32(h, v);
  }
  _dv.setFloat64(0, v, true);
  h = mixU32(h, _dv.getUint32(0, true));
  h = mixU32(h, _dv.getUint32(4, true));
  return h;
}

/**
 * Computes a deterministic 32-bit FNV-1a hash of the game's simulation state.
 */
export function computeStateHash(g: Game): number {
  let h = FNV_OFFSET_BASIS;

  h = mixNum(h, g.rng.seed);

  h = mixU32(h, g.players.length);
  for (const p of g.players) {
    h = mixNum(h, p.cash);
    h = mixNum(h, p.bank);
    h = mixNum(h, p.loan);
    h = mixNum(h, p.node);
    h = mixNum(h, p.points);
    h = mixNum(h, p.hospital);
    h = mixNum(h, p.prison);
    h = mixNum(h, p.sleep);
    h = mixU32(h, p.cards.length);
    for (const c of p.cards) h = mixNum(h, c);
    h = mixU32(h, p.tools.length);
    for (const t of p.tools) h = mixNum(h, t);
  }

  h = mixU32(h, g.board.lands.length);
  for (const l of g.board.lands) {
    h = mixNum(h, l.owner);
    h = mixNum(h, l.level);
    h = mixNum(h, l.tmpState);
  }

  h = mixU32(h, g.board.facilities.length);
  for (const f of g.board.facilities) {
    h = mixNum(h, f.owner);
    h = mixNum(h, f.type);
    h = mixNum(h, f.level);
    h = mixNum(h, f.tmpState);
  }

  h = mixU32(h, g.stocks.stocks.length);
  for (const s of g.stocks.stocks) {
    h = mixNum(h, s.price);
  }
  h = mixU32(h, g.stocks.holdings.length);
  for (const row of g.stocks.holdings) {
    h = mixU32(h, row.length);
    for (const holding of row) {
      h = mixNum(h, holding.shares);
    }
  }

  h = mixU32(h, g.objects.slots.length);
  for (const o of g.objects.slots) {
    h = mixNum(h, o.type);
    h = mixNum(h, o.node);
    h = mixNum(h, o.owner);
  }

  return h >>> 0;
}
