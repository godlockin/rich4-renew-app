import { describe, expect, it } from 'vitest';
import { strToU8, zlibSync } from 'fflate';
import {
  MAX_DECODED_BYTES,
  SHARE_CODE_PREFIX,
  decodeMapShareCode,
  encodeMapShareCode,
  validateRawMap,
  type CustomEventDef,
  type CustomEventPack,
  type RawMapWithEvents,
} from './map-schema';

function makeNodeHex(opts: { x?: number; y?: number; adjacent?: [number, number, number, number]; ref?: number } = {}): string {
  const buf = new Uint8Array(40);
  const dv = new DataView(buf.buffer);
  dv.setInt16(0, opts.x ?? 100, true);
  dv.setInt16(2, opts.y ?? 200, true);
  const adj = opts.adjacent ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) dv.setUint16(24 + i * 2, adj[i], true);
  dv.setUint16(32, opts.ref ?? 0, true);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

const zeroHex = (bytes: number) => '00'.repeat(bytes);

function makeValidMap(): RawMapWithEvents {
  const customEvents: CustomEventDef[] = [
    { id: 1, title: '夜市發財', kind: 'cash', amount: 1500, message: '擺攤大賺 1500 元！' },
    { id: 2, title: '點券驚喜', kind: 'points', amount: 30, message: '獲得 30 點券。' },
  ];
  return {
    map_id: 200,
    name: '測試地圖',
    width: 2304,
    nodes: [
      { id: 1, raw_hex: makeNodeHex({ adjacent: [2, 5, 0, 0], ref: 2001 }) },
      { id: 2, raw_hex: makeNodeHex({ adjacent: [1, 3, 0, 0], ref: 4001 }) },
      { id: 3, raw_hex: makeNodeHex({ adjacent: [2, 4, 0, 0], ref: 6001 }) },
      { id: 4, raw_hex: makeNodeHex({ adjacent: [3, 5, 0, 0], ref: 8001 }) },
      { id: 5, raw_hex: makeNodeHex({ adjacent: [4, 1, 0, 0], ref: 8002 }) },
    ],
    lands: [{ id: 1, raw_hex: zeroHex(0x34) }],
    facilities: [{ id: 1, raw_hex: zeroHex(0x38) }],
    companies: [{ id: 1, raw_hex: zeroHex(0x34) }],
    landscapes: [{ id: 1, raw_hex: zeroHex(0x1c) }],
    customEvents,
  };
}

describe('validateRawMap', () => {
  it('accepts a valid RawMap with refs (2001, 4001, 6001, 8001, 8002) and customEvents', () => {
    const map = makeValidMap();
    const pack: CustomEventPack = { name: '測試事件包', events: map.customEvents! };
    expect(pack.events).toHaveLength(2);
    expect(validateRawMap(map)).toEqual({ ok: true, errors: [] });
  });

  it('rejects non-contiguous or non-1-based node IDs', () => {
    const map = makeValidMap();
    map.nodes[1].id = 3;
    const res = validateRawMap(map);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('contiguous 1-based'))).toBe(true);
  });

  it('rejects out-of-range and self-loop neighbor IDs', () => {
    const map = makeValidMap();
    map.nodes[0].raw_hex = makeNodeHex({ adjacent: [99, 1, 0, 0], ref: 2001 });
    const res = validateRawMap(map);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('out of range'))).toBe(true);
    expect(res.errors.some(e => e.includes('cannot reference itself'))).toBe(true);
  });

  it('rejects invalid ref targets for lands, facilities, companies, and unknown ranges', () => {
    const map = makeValidMap();
    map.lands = [];
    map.facilities = [];
    map.companies = [];
    map.nodes[3].raw_hex = makeNodeHex({ adjacent: [3, 5, 0, 0], ref: 9999 });
    const res = validateRawMap(map);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('missing land index'))).toBe(true);
    expect(res.errors.some(e => e.includes('missing facility index'))).toBe(true);
    expect(res.errors.some(e => e.includes('missing company index'))).toBe(true);
    expect(res.errors.some(e => e.includes('not a valid target'))).toBe(true);
  });

  it('rejects invalid customEvents entries', () => {
    const map = makeValidMap();
    map.customEvents = [
      { id: 1, title: '', kind: 'invalid' as CustomEventDef['kind'], amount: Number.NaN, message: 'bad' },
      { id: 1, title: 'dup', kind: 'hospital', amount: 2, message: 'dup id' },
    ];
    const res = validateRawMap(map);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('.title'))).toBe(true);
    expect(res.errors.some(e => e.includes('.kind'))).toBe(true);
    expect(res.errors.some(e => e.includes('.amount'))).toBe(true);
    expect(res.errors.some(e => e.includes('duplicated'))).toBe(true);
  });
});

describe('encodeMapShareCode / decodeMapShareCode', () => {
  it('round-trips a valid RawMapWithEvents through zlib + base64url', () => {
    const map = makeValidMap();
    const code = encodeMapShareCode(map);
    expect(code.startsWith(SHARE_CODE_PREFIX)).toBe(true);
    expect(code.slice(SHARE_CODE_PREFIX.length)).toMatch(/^[A-Za-z0-9\-_]+$/);

    const decoded = decodeMapShareCode(code);
    expect(decoded).toEqual(map);
  });

  it('rejects invalid prefix and tampered/corrupt payloads', () => {
    const code = encodeMapShareCode(makeValidMap());
    expect(() => decodeMapShareCode('WRONG:' + code.slice(SHARE_CODE_PREFIX.length))).toThrow(/RICH4MAP1:/);
    expect(() => decodeMapShareCode(SHARE_CODE_PREFIX + '!!!invalid!!!')).toThrow();
    const tampered = SHARE_CODE_PREFIX + 'AAAA' + code.slice(SHARE_CODE_PREFIX.length + 4);
    expect(() => decodeMapShareCode(tampered)).toThrow();
  });

  it('rejects decoded payloads exceeding the 512KB cap', () => {
    const oversizedJson = JSON.stringify({ pad: 'a'.repeat(MAX_DECODED_BYTES + 1024) });
    const compressed = zlibSync(strToU8(oversizedJson));
    let bin = '';
    for (let i = 0; i < compressed.length; i++) bin += String.fromCharCode(compressed[i]);
    const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeMapShareCode(SHARE_CODE_PREFIX + b64url)).toThrow(/524288|exceeds/i);
  });
});
