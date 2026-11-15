/**
 * 大富翁4 派對模式中繼伺服器（相容 game/src/ui/relay-peer.ts / party-presence.ts / party-report.ts）。
 * 零第三方依賴（僅使用 Node 內建 node:http 與 node:crypto），監聽 127.0.0.1:18443（可由 PORT / HOST 環境變數覆蓋）。
 *
 * 支援能力：
 *  - WebSocket 中繼：60 秒斷線會話保留、編號重傳（s/ack）、虛擬連線（conn/open/nopeer/d/close）、20 秒靜默房主搶佔（evicted）
 *  - HTTP 接口：/health、/stats（35 秒滑動在線人數）、/report、/chat、以及服務端公開大廳 /rooms（25 秒 TTL）
 *  - 月度出站流量上限（MONTH_CAP_GB，預設 800 GB），超限回傳 full 讓用戶端自動降級 P2P
 */
import http from 'node:http';
import crypto from 'node:crypto';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 18443);
const HOLD_MS = 60_000;
const TAKEOVER_MS = 20_000;
const PRESENCE_TTL_MS = 35_000;
const ROOM_TTL_MS = 25_000;
const MONTH_CAP_BYTES = Number(process.env.MONTH_CAP_GB || 800) * 1024 * 1024 * 1024;
const MAX_BUFFER = 8 << 20;
const MAX_FRAME = 2 * 1024 * 1024;
const MAX_SESSIONS = 10_000;
const MAX_CONNS = 20_000;
const MAX_PRESENCE = 20_000;
const MAX_PUBLIC_ROOMS = 2_000;
const MAX_LEADERBOARD_BODY = 4096;
const MAX_LEADERBOARD_WEEKS = 16;
const MAX_LEADERBOARD_ENTRIES_PER_WEEK = 100;
const LEADERBOARD_TOP_N = 20;

let monthKey = new Date().toISOString().slice(0, 7);
let monthOutBytes = 0;
function trackBytes(n) {
  const cur = new Date().toISOString().slice(0, 7);
  if (cur !== monthKey) { monthKey = cur; monthOutBytes = 0; }
  monthOutBytes += n;
}
const overCap = () => monthOutBytes >= MONTH_CAP_BYTES;

/** @type {Map<string, { id: string, token: string, ws: any, sIn: number, sOut: number, out: [number, string][], outBytes: number, lastHeard: number, lostAt: number, app: any }>} */
const sessions = new Map();
/** @type {Map<string, { a: string, b: string }>} */
const conns = new Map();
/** @type {Map<string, { dev: string, where: string, v?: string, plat?: string, name?: string, at: number }>} */
const presence = new Map();
/** @type {Map<string, any>} */
const publicRooms = new Map();
/** @type {Map<string, Array<{ puzzleId: string, weekKey: string, seed: number, playerName: string, turns: number, finalAssets: number, stateHash: number, digest: string, submittedAt: number }>>} */
const puzzleLeaderboards = new Map();

function lruSet(map, key, val, max) {
  if (map.has(key)) map.delete(key);
  else if (map.size >= max) map.delete(map.keys().next().value);
  map.set(key, val);
}

// ------------------------------------------------------------------ minimal RFC 6455 WebSocket framing

function wsEncodeHeader(firstByte, len) {
  if (len < 126) return Buffer.from([firstByte, len]);
  if (len < 65536) {
    const h = Buffer.allocUnsafe(4);
    h[0] = firstByte; h[1] = 126; h.writeUInt16BE(len, 2);
    return h;
  }
  const h = Buffer.allocUnsafe(10);
  h[0] = firstByte; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2);
  return h;
}

function wsSend(ws, text) {
  if (!ws || ws.destroyed || ws.writableEnded) return;
  const payload = Buffer.from(text, 'utf8');
  trackBytes(payload.length);
  ws.write(Buffer.concat([wsEncodeHeader(0x81, payload.length), payload]));
}

function attachWs(socket, onMsg, onClose) {
  let buf = Buffer.alloc(0);
  let closed = false;
  let fragParts = null;
  let fragBytes = 0;
  const finish = () => { if (!closed) { closed = true; onClose(); } };
  const abort = () => { try { socket.destroy(); } catch { /* ignore */ } finish(); };
  socket.on('data', chunk => {
    if (closed) return;
    if (buf.length + chunk.length > MAX_FRAME * 2) { abort(); return; }
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        const bigLen = buf.readBigUInt64BE(2);
        if (bigLen > BigInt(MAX_FRAME)) { abort(); return; }
        len = Number(bigLen);
        off = 10;
      }
      if (len > MAX_FRAME) { abort(); return; }
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) break;
      const data = Buffer.from(buf.subarray(off, off + len));
      if (masked) {
        const mask = buf.subarray(maskOff, maskOff + 4);
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      }
      buf = buf.subarray(off + len);
      if (opcode >= 0x8) {
        if (!fin) { abort(); return; }
        if (opcode === 0x8) { socket.end(); finish(); return; }
        if (opcode === 0x9) { socket.write(Buffer.concat([wsEncodeHeader(0x8a, data.length), data])); continue; }
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        if (fragParts !== null) { abort(); return; }
        if (fin) {
          onMsg(data.toString('utf8'));
        } else {
          fragParts = [data];
          fragBytes = data.length;
        }
      } else if (opcode === 0x0) {
        if (fragParts === null) { abort(); return; }
        fragBytes += data.length;
        if (fragBytes > MAX_FRAME) { abort(); return; }
        fragParts.push(data);
        if (fin) {
          const full = Buffer.concat(fragParts, fragBytes);
          fragParts = null;
          fragBytes = 0;
          onMsg(full.toString('utf8'));
        }
      } else {
        abort();
        return;
      }
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
}

// ------------------------------------------------------------------ session & relay logic

function sendTo(s, obj, numbered = true) {
  if (!s) return;
  if (!numbered) {
    if (s.ws) wsSend(s.ws, JSON.stringify(obj));
    return;
  }
  const text = JSON.stringify({ ...obj, s: ++s.sOut });
  s.out.push([s.sOut, text]);
  s.outBytes += text.length;
  if (s.outBytes > MAX_BUFFER) { dropSession(s); return; }
  if (s.ws) wsSend(s.ws, text);
}

function dropSession(s) {
  if (sessions.get(s.id) === s) sessions.delete(s.id);
  try { s.ws?.destroy(); } catch { /* ignore */ }
  s.ws = null;
  for (const [cid, c] of conns) {
    if (c.a !== s.id && c.b !== s.id) continue;
    const otherId = c.a === s.id ? c.b : c.a;
    conns.delete(cid);
    sendTo(sessions.get(otherId), { t: 'close', cid });
  }
}

function handleFrame(ws, state, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  const now = Date.now();
  if (state.s) state.s.lastHeard = now;

  if (m.t === 'p') {
    wsSend(ws, JSON.stringify({ t: 'q', at: m.at }));
    return;
  }

  if (m.t === 'hello') {
    const id = String(m.id || '').slice(0, 80);
    if (!id) { wsSend(ws, JSON.stringify({ t: 'server-error' })); ws.end(); return; }
    const existing = sessions.get(id);
    if (existing) {
      // 同一 token 斷線重連：無感續傳
      if (m.token && m.token === existing.token) {
        if (existing.ws && existing.ws !== ws) try { existing.ws.destroy(); } catch { /* ignore */ }
        existing.ws = ws;
        existing.lostAt = 0;
        existing.lastHeard = now;
        const clientAck = Number(m.ack || 0);
        existing.out = existing.out.filter(([seq]) => seq > clientAck);
        existing.outBytes = existing.out.reduce((a, [, t]) => a + t.length, 0);
        state.s = existing;
        wsSend(ws, JSON.stringify({ t: 'ok', token: existing.token, ack: existing.sIn, fresh: false }));
        for (const [, text] of existing.out) wsSend(ws, text);
        return;
      }
      // 房主已斷線或 20 秒無回應：允許新房主接管房間 ID
      const silent = (existing.lostAt ? (now - existing.lostAt) : (now - existing.lastHeard)) > TAKEOVER_MS;
      if (!silent) {
        wsSend(ws, JSON.stringify({ t: 'taken' }));
        ws.end();
        return;
      }
      if (existing.ws) {
        wsSend(existing.ws, JSON.stringify({ t: 'evicted' }));
        try { existing.ws.end(); } catch { /* ignore */ }
      }
      dropSession(existing);
    }
    if (overCap() || sessions.size >= MAX_SESSIONS) {
      wsSend(ws, JSON.stringify({ t: 'full' }));
      ws.end();
      return;
    }
    const fresh = !!(m.token);
    const s = {
      id,
      token: crypto.randomBytes(12).toString('hex'),
      ws,
      sIn: 0,
      sOut: 0,
      out: [],
      outBytes: 0,
      lastHeard: now,
      lostAt: 0,
      app: m.app || {},
    };
    sessions.set(id, s);
    state.s = s;
    wsSend(ws, JSON.stringify({ t: 'ok', token: s.token, ack: 0, fresh }));
    return;
  }

  const s = state.s;
  if (!s) return;

  if (m.t === 'bye') {
    dropSession(s);
    ws.end();
    return;
  }

  if (m.t === 'ack') {
    const a = Number(m.a || 0);
    s.out = s.out.filter(([seq]) => seq > a);
    s.outBytes = s.out.reduce((n, [, t]) => n + t.length, 0);
    return;
  }

  if (typeof m.s === 'number') {
    if (m.s <= s.sIn) return;
    s.sIn = m.s;
    wsSend(ws, JSON.stringify({ t: 'ack', a: s.sIn }));
  }

  if (m.t === 'conn') {
    const cid = String(m.cid || ''), to = String(m.to || '');
    const peer = sessions.get(to);
    if (!peer || !cid || conns.has(cid) || conns.size >= MAX_CONNS) {
      sendTo(s, { t: 'nopeer', cid });
      return;
    }
    conns.set(cid, { a: s.id, b: peer.id });
    sendTo(peer, { t: 'conn', cid, from: s.id });
    sendTo(s, { t: 'open', cid });
    return;
  }

  if (m.t === 'd') {
    const c = conns.get(String(m.cid || ''));
    if (!c || (c.a !== s.id && c.b !== s.id)) return;
    const target = c.a === s.id ? c.b : c.a;
    sendTo(sessions.get(target), { t: 'd', cid: m.cid, d: m.d });
    return;
  }

  if (m.t === 'close') {
    const cid = String(m.cid || '');
    const c = conns.get(cid);
    if (!c || (c.a !== s.id && c.b !== s.id)) return;
    conns.delete(cid);
    const target = c.a === s.id ? c.b : c.a;
    sendTo(sessions.get(target), { t: 'close', cid });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const s of [...sessions.values()]) {
    if (!s.ws && s.lostAt && now - s.lostAt > HOLD_MS) dropSession(s);
  }
  for (const [k, p] of presence) if (now - p.at > PRESENCE_TTL_MS) presence.delete(k);
  for (const [k, r] of publicRooms) if (now - r.at > ROOM_TTL_MS) publicRooms.delete(k);
}, 5000);

// ------------------------------------------------------------------ HTTP endpoints

function readBody(req, limit = 32_768) {
  return new Promise(resolve => {
    const chunks = [];
    let len = 0;
    let done = false;
    const finish = val => { if (!done) { done = true; resolve(val); } };
    req.on('data', c => {
      len += c.length;
      if (len > limit) {
        req.destroy();
        finish(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      try { finish(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { finish(null); }
    });
    req.on('error', () => finish(null));
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  trackBytes(Buffer.byteLength(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (u.pathname === '/health') {
    sendJson(res, 200, {
      ok: !overCap(),
      sessions: sessions.size,
      conns: conns.size,
      month: monthKey,
      outBytes: monthOutBytes,
      capBytes: MONTH_CAP_BYTES,
    });
    return;
  }

  if (u.pathname === '/stats') {
    const dev = (u.searchParams.get('dev') || '').trim().slice(0, 32);
    const where = (u.searchParams.get('where') || '').trim();
    if (dev) {
      if (where === 'off') presence.delete(dev);
      else if (where === 'menu' || where === 'room' || where === 'game') {
        lruSet(presence, dev, {
          dev,
          where,
          v: u.searchParams.get('v') || undefined,
          plat: u.searchParams.get('plat') || undefined,
          name: u.searchParams.get('name') || undefined,
          at: Date.now(),
        }, MAX_PRESENCE);
      }
    }
    const now = Date.now();
    let menu = 0, room = 0, game = 0;
    for (const p of presence.values()) {
      if (now - p.at > PRESENCE_TTL_MS) continue;
      if (p.where === 'menu') menu++;
      else if (p.where === 'room') room++;
      else if (p.where === 'game') game++;
    }
    sendJson(res, 200, { online: menu + room + game, menu, room, game });
    return;
  }

  // 服務端公開房間列表（供後續取代用戶端 LOBBY 搶註機制）
  if (u.pathname === '/rooms') {
    const now = Date.now();
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (b?.code && !b.private) lruSet(publicRooms, String(b.code), { ...b, at: now }, MAX_PUBLIC_ROOMS);
      else if (b?.remove) publicRooms.delete(String(b.remove));
      sendJson(res, 200, { ok: true });
      return;
    }
    const list = [...publicRooms.values()].filter(r => now - r.at <= ROOM_TTL_MS).sort((a, b) => b.at - a.at);
    sendJson(res, 200, { rooms: list });
    return;
  }

  if (u.pathname === '/report' && req.method === 'POST') {
    const b = await readBody(req);
    if (b) console.log(`[report] ${b.kind || 'unknown'} room=${b.room || '-'} seq=${b.seq ?? '-'} msg=${b.msg || ''}`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (u.pathname === '/chat' && req.method === 'POST') {
    await readBody(req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (u.pathname === '/puzzles/leaderboard') {
    if (req.method === 'GET') {
      const week = (u.searchParams.get('week') || '').trim();
      if (!/^\d{4}-W\d{2}$/.test(week)) {
        sendJson(res, 400, { error: 'invalid or missing week' });
        return;
      }
      const list = puzzleLeaderboards.get(week) || [];
      sendJson(res, 200, { week, entries: list.slice(0, LEADERBOARD_TOP_N) });
      return;
    }
    if (req.method === 'POST') {
      const b = await readBody(req, MAX_LEADERBOARD_BODY);
      if (!b || typeof b !== 'object' || Array.isArray(b)) {
        sendJson(res, 400, { error: 'invalid payload' });
        return;
      }
      const valid =
        typeof b.puzzleId === 'string' && b.puzzleId.trim().length > 0 && b.puzzleId.length <= 64 &&
        typeof b.weekKey === 'string' && /^\d{4}-W\d{2}$/.test(b.weekKey) &&
        typeof b.seed === 'number' && Number.isFinite(b.seed) &&
        typeof b.playerName === 'string' && b.playerName.trim().length > 0 && b.playerName.length <= 64 &&
        typeof b.turns === 'number' && Number.isInteger(b.turns) && b.turns >= 0 &&
        typeof b.finalAssets === 'number' && Number.isFinite(b.finalAssets) &&
        typeof b.stateHash === 'number' && Number.isInteger(b.stateHash) && b.stateHash >= 0 &&
        typeof b.digest === 'string' && /^[0-9a-f]{8,64}$/i.test(b.digest);
      if (!valid) {
        sendJson(res, 400, { error: 'invalid receipt fields' });
        return;
      }
      const week = b.weekKey;
      let list = puzzleLeaderboards.get(week);
      if (list) {
        puzzleLeaderboards.delete(week);
      } else {
        if (puzzleLeaderboards.size >= MAX_LEADERBOARD_WEEKS) {
          puzzleLeaderboards.delete(puzzleLeaderboards.keys().next().value);
        }
        list = [];
      }
      const entry = {
        puzzleId: b.puzzleId.trim(),
        weekKey: week,
        seed: b.seed,
        playerName: b.playerName.trim().slice(0, 32),
        turns: b.turns,
        finalAssets: b.finalAssets,
        stateHash: b.stateHash,
        digest: b.digest.toLowerCase(),
        submittedAt: Date.now(),
      };
      list.push(entry);
      list.sort((a, c) => (a.turns - c.turns) || (c.finalAssets - a.finalAssets) || (a.submittedAt - c.submittedAt));
      if (list.length > MAX_LEADERBOARD_ENTRIES_PER_WEEK) list.length = MAX_LEADERBOARD_ENTRIES_PER_WEEK;
      puzzleLeaderboards.set(week, list);
      const idx = list.indexOf(entry);
      sendJson(res, 200, { ok: true, week, rank: idx === -1 ? null : idx + 1, total: list.length });
      return;
    }
  }

  sendJson(res, 404, { error: 'not found' });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const state = { s: null };
  attachWs(
    socket,
    msg => handleFrame(socket, state, msg),
    () => {
      if (state.s && state.s.ws === socket) {
        state.s.ws = null;
        state.s.lostAt = Date.now();
      }
    },
  );
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`rich4 party-relay listening on http://${HOST}:${boundPort}`);
});
