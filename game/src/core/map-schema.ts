import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';
import type { RawMap } from './board';

export const CUSTOM_EVENT_KINDS = ['cash', 'points', 'card', 'hospital', 'prison'] as const;
export type CustomEventKind = (typeof CUSTOM_EVENT_KINDS)[number];

export interface CustomEventDef {
  id: number;
  title: string;
  kind: CustomEventKind;
  amount: number;
  message: string;
}

export interface CustomEventPack {
  name?: string;
  events: CustomEventDef[];
}

export interface RawMapWithEvents extends RawMap {
  customEvents?: CustomEventDef[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export const SHARE_CODE_PREFIX = 'RICH4MAP1:';
export const MAX_DECODED_BYTES = 512 * 1024;

const NODE_MIN_BYTES = 40;
const LAND_MIN_BYTES = 0x34;
const FACILITY_MIN_BYTES = 0x38;
const COMPANY_MIN_BYTES = 0x34;
const LANDSCAPE_MIN_BYTES = 0x1c;

const HEX_RE = /^[0-9a-fA-F]*$/;
const B64URL_RE = /^[A-Za-z0-9\-_]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readU16LE(hex: string, byteOffset: number): number {
  const i = byteOffset * 2;
  const lo = parseInt(hex.slice(i, i + 2), 16);
  const hi = parseInt(hex.slice(i + 2, i + 4), 16);
  return lo | (hi << 8);
}

function checkRawRecord(rec: unknown, label: string, minBytes: number, errors: string[]): rec is { id: number; raw_hex: string } {
  if (!isPlainObject(rec)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  if (!Number.isInteger(rec.id)) {
    errors.push(`${label}.id must be an integer`);
    return false;
  }
  if (typeof rec.raw_hex !== 'string' || rec.raw_hex.length % 2 !== 0 || !HEX_RE.test(rec.raw_hex)) {
    errors.push(`${label}.raw_hex must be a valid even-length hex string`);
    return false;
  }
  if (rec.raw_hex.length < minBytes * 2) {
    errors.push(`${label}.raw_hex must be at least ${minBytes} bytes`);
    return false;
  }
  return true;
}

/** Validate an array of CustomEventDef entries. */
export function validateCustomEvents(events: unknown): string[] {
  if (!Array.isArray(events)) return ['customEvents must be an array'];
  const errors: string[] = [];
  const seenIds = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const prefix = `customEvents[${i}]`;
    if (!isPlainObject(ev)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof ev.id !== 'number' || !Number.isInteger(ev.id) || ev.id < 0) {
      errors.push(`${prefix}.id must be a non-negative integer`);
    } else if (seenIds.has(ev.id)) {
      errors.push(`${prefix}.id (${ev.id}) is duplicated`);
    } else {
      seenIds.add(ev.id);
    }
    if (typeof ev.title !== 'string' || ev.title.trim().length === 0) {
      errors.push(`${prefix}.title must be a non-empty string`);
    }
    if (typeof ev.kind !== 'string' || !(CUSTOM_EVENT_KINDS as readonly string[]).includes(ev.kind)) {
      errors.push(`${prefix}.kind must be one of ${CUSTOM_EVENT_KINDS.join(', ')}`);
    }
    if (typeof ev.amount !== 'number' || !Number.isFinite(ev.amount)) {
      errors.push(`${prefix}.amount must be a finite number`);
    }
    if (typeof ev.message !== 'string') {
      errors.push(`${prefix}.message must be a string`);
    }
  }
  return errors;
}

/** Validate RawMap structure, contiguous 1-based node IDs, neighbor IDs, ref targets, and optional customEvents. */
export function validateRawMap(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['Map must be an object'] };
  }

  if (typeof raw.map_id !== 'number' || !Number.isInteger(raw.map_id) || raw.map_id < 0) {
    errors.push('map_id must be a non-negative integer');
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  }
  if (raw.width !== undefined && (typeof raw.width !== 'number' || !Number.isFinite(raw.width) || raw.width <= 0)) {
    errors.push('width must be a positive finite number');
  }

  const arrays: Array<[string, unknown, number]> = [
    ['nodes', raw.nodes, NODE_MIN_BYTES],
    ['lands', raw.lands, LAND_MIN_BYTES],
    ['facilities', raw.facilities, FACILITY_MIN_BYTES],
    ['companies', raw.companies, COMPANY_MIN_BYTES],
    ['landscapes', raw.landscapes, LANDSCAPE_MIN_BYTES],
  ];

  for (const [key, val] of arrays) {
    if (!Array.isArray(val)) {
      errors.push(`${key} must be an array`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const nodes = raw.nodes as unknown[];
  const lands = raw.lands as unknown[];
  const facilities = raw.facilities as unknown[];
  const companies = raw.companies as unknown[];
  const landscapes = raw.landscapes as unknown[];

  if (nodes.length === 0) {
    errors.push('nodes must not be empty');
  }

  for (let i = 0; i < lands.length; i++) checkRawRecord(lands[i], `lands[${i}]`, LAND_MIN_BYTES, errors);
  for (let i = 0; i < facilities.length; i++) checkRawRecord(facilities[i], `facilities[${i}]`, FACILITY_MIN_BYTES, errors);
  for (let i = 0; i < companies.length; i++) checkRawRecord(companies[i], `companies[${i}]`, COMPANY_MIN_BYTES, errors);
  for (let i = 0; i < landscapes.length; i++) checkRawRecord(landscapes[i], `landscapes[${i}]`, LANDSCAPE_MIN_BYTES, errors);

  const nodeCount = nodes.length;
  for (let i = 0; i < nodeCount; i++) {
    const rec = nodes[i];
    if (!checkRawRecord(rec, `nodes[${i}]`, NODE_MIN_BYTES, errors)) continue;

    if (rec.id !== i + 1) {
      errors.push(`nodes[${i}].id must be ${i + 1} (contiguous 1-based), got ${rec.id}`);
    }

    for (let slot = 0; slot < 4; slot++) {
      const adj = readU16LE(rec.raw_hex, 24 + slot * 2);
      if (adj === 0) continue;
      if (adj < 1 || adj > nodeCount) {
        errors.push(`nodes[${i}].adjacent[${slot}] (${adj}) is out of range 1..${nodeCount}`);
      } else if (adj === rec.id) {
        errors.push(`nodes[${i}].adjacent[${slot}] (${adj}) cannot reference itself`);
      }
    }

    const ref = readU16LE(rec.raw_hex, 32);
    if (ref === 0 || ref === 8001 || ref === 8002) {
      // Valid: empty, hospital, or prison
    } else if (ref >= 2001 && ref < 4000) {
      if (ref - 2001 >= lands.length) {
        errors.push(`nodes[${i}].ref (${ref}) references missing land index ${ref - 2001}`);
      }
    } else if (ref >= 4001 && ref < 6000) {
      if (ref - 4001 >= facilities.length) {
        errors.push(`nodes[${i}].ref (${ref}) references missing facility index ${ref - 4001}`);
      }
    } else if (ref >= 6001 && ref < 8000) {
      if (ref - 6001 >= companies.length) {
        errors.push(`nodes[${i}].ref (${ref}) references missing company index ${ref - 6001}`);
      }
    } else {
      errors.push(`nodes[${i}].ref (${ref}) is not a valid target`);
    }
  }

  if (raw.stock_names !== undefined) {
    if (!Array.isArray(raw.stock_names) || raw.stock_names.length !== 12 || !raw.stock_names.every(s => typeof s === 'string')) {
      errors.push('stock_names must be an array of 12 strings');
    }
  }

  if (raw.customEvents !== undefined) {
    errors.push(...validateCustomEvents(raw.customEvents));
  }

  return { ok: errors.length === 0, errors };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  if (!B64URL_RE.test(str)) {
    throw new Error('Invalid base64url characters in share code');
  }
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode a validated RawMap (with optional customEvents) into a RICH4MAP1: share code. */
export function encodeMapShareCode(raw: RawMapWithEvents): string {
  const check = validateRawMap(raw);
  if (!check.ok) {
    throw new Error(`Invalid map: ${check.errors.join('; ')}`);
  }
  const jsonBytes = strToU8(JSON.stringify(raw));
  if (jsonBytes.byteLength > MAX_DECODED_BYTES) {
    throw new Error(`Map payload exceeds ${MAX_DECODED_BYTES} bytes`);
  }
  const compressed = zlibSync(jsonBytes, { level: 6 });
  return SHARE_CODE_PREFIX + toBase64Url(compressed);
}

/** Decode a RICH4MAP1: share code into a validated RawMapWithEvents, enforcing the 512KB decoded cap. */
export function decodeMapShareCode(code: string): RawMapWithEvents {
  if (typeof code !== 'string' || !code.startsWith(SHARE_CODE_PREFIX)) {
    throw new Error(`Share code must start with ${SHARE_CODE_PREFIX}`);
  }
  const payload = code.slice(SHARE_CODE_PREFIX.length);
  if (!payload || payload.length > MAX_DECODED_BYTES * 2) {
    throw new Error('Share code payload is empty or oversized');
  }
  const compressed = fromBase64Url(payload);
  let decoded: Uint8Array;
  try {
    decoded = unzlibSync(compressed);
  } catch {
    throw new Error('Corrupt share code payload');
  }
  if (decoded.byteLength > MAX_DECODED_BYTES) {
    throw new Error(`Decoded map exceeds ${MAX_DECODED_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(decoded));
  } catch {
    throw new Error('Share code does not contain valid JSON');
  }
  const check = validateRawMap(parsed);
  if (!check.ok) {
    throw new Error(`Invalid map: ${check.errors.join('; ')}`);
  }
  return parsed as RawMapWithEvents;
}
