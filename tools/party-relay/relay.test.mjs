import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_PATH = path.join(__dirname, 'relay.mjs');

function encodeClientFrame({ fin = true, opcode = 0x1, payload = Buffer.alloc(0) }) {
  const b0 = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([b0, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = b0;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = b0;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const key = crypto.randomBytes(16).toString('base64');
    let upgraded = false;
    let buf = Buffer.alloc(0);
    const messages = [];
    const waiters = [];
    let closed = false;
    const closeWaiters = [];

    const flushWaiter = () => {
      while (messages.length > 0 && waiters.length > 0) {
        const w = waiters.shift();
        w.resolve(messages.shift());
      }
    };

    socket.on('connect', () => {
      socket.write(
        'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString('utf8');
        if (!head.startsWith('HTTP/1.1 101')) {
          reject(new Error(`Unexpected handshake: ${head}`));
          socket.destroy();
          return;
        }
        upgraded = true;
        buf = buf.subarray(idx + 4);
        resolve(client);
      }

      while (buf.length >= 2) {
        const b0 = buf[0], b1 = buf[1];
        const opcode = b0 & 0x0f;
        let len = b1 & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) break;
        const data = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x1 || opcode === 0x2) {
          messages.push(JSON.parse(data.toString('utf8')));
          flushWaiter();
        }
      }
    });

    socket.on('close', () => {
      closed = true;
      while (waiters.length > 0) waiters.shift().reject(new Error('socket closed'));
      while (closeWaiters.length > 0) closeWaiters.shift()();
    });
    socket.on('error', err => {
      if (!upgraded) reject(err);
    });

    const client = {
      socket,
      sendJson(obj) {
        socket.write(encodeClientFrame({ fin: true, opcode: 0x1, payload: Buffer.from(JSON.stringify(obj), 'utf8') }));
      },
      sendRaw(bufData) {
        socket.write(bufData);
      },
      nextMsg(timeoutMs = 2000) {
        if (messages.length > 0) return Promise.resolve(messages.shift());
        if (closed) return Promise.reject(new Error('socket closed'));
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const idx = waiters.indexOf(entry);
            if (idx !== -1) waiters.splice(idx, 1);
            rej(new Error('timeout waiting for WS message'));
          }, timeoutMs);
          const entry = {
            resolve: val => { clearTimeout(timer); res(val); },
            reject: err => { clearTimeout(timer); rej(err); },
          };
          waiters.push(entry);
        });
      },
      waitClose(timeoutMs = 2000) {
        if (closed) return Promise.resolve();
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('timeout waiting for close')), timeoutMs);
          closeWaiters.push(() => { clearTimeout(timer); res(); });
        });
      },
      close() {
        socket.destroy();
      },
    };
  });
}

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    }).on('error', reject);
  });
}

describe('party-relay security & framing', () => {
  let proc;
  let port;

  before(async () => {
    proc = spawn(process.execPath, [RELAY_PATH], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`Relay startup timeout: ${out}`)), 5000);
      proc.stdout.on('data', chunk => {
        out += chunk.toString('utf8');
        const m = out.match(/listening on http:\/\/[^:]+:(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      proc.stderr.on('data', chunk => { out += chunk.toString('utf8'); });
      proc.on('exit', code => {
        clearTimeout(timer);
        reject(new Error(`Relay exited early (${code}): ${out}`));
      });
    });
  });

  after(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  });

  it('blocks 0ms disconnect hijacking without token and lets original host reconnect with token', async () => {
    const roomId = `room-hijack-${Date.now()}`;
    const host = await connectWs(port);
    host.sendJson({ t: 'hello', id: roomId });
    const ok1 = await host.nextMsg();
    assert.equal(ok1.t, 'ok');
    assert.ok(ok1.token);

    // Host disconnects abruptly
    host.close();
    await host.waitClose();

    // Attacker immediately tries to take over roomId without valid token
    const attacker = await connectWs(port);
    attacker.sendJson({ t: 'hello', id: roomId });
    const taken = await attacker.nextMsg();
    assert.equal(taken.t, 'taken');
    await attacker.waitClose();

    // Original host reconnects with its token
    const hostRe = await connectWs(port);
    hostRe.sendJson({ t: 'hello', id: roomId, token: ok1.token, ack: 0 });
    const ok2 = await hostRe.nextMsg();
    assert.equal(ok2.t, 'ok');
    assert.equal(ok2.token, ok1.token);
    assert.equal(ok2.fresh, false);

    hostRe.sendJson({ t: 'bye' });
    await hostRe.waitClose();
  });

  it('reassembles RFC 6455 fragmented WebSocket frames', async () => {
    const client = await connectWs(port);
    const payloadStr = JSON.stringify({ t: 'p', at: 'A'.repeat(4096) });
    const buf = Buffer.from(payloadStr, 'utf8');
    const p1 = buf.subarray(0, 1000);
    const p2 = buf.subarray(1000, 2500);
    const p3 = buf.subarray(2500);

    client.sendRaw(Buffer.concat([
      encodeClientFrame({ fin: false, opcode: 0x1, payload: p1 }),
      encodeClientFrame({ fin: false, opcode: 0x0, payload: p2 }),
      encodeClientFrame({ fin: true, opcode: 0x0, payload: p3 }),
    ]));

    const reply = await client.nextMsg();
    assert.equal(reply.t, 'q');
    assert.equal(reply.at.length, 4096);
    client.close();
  });

  it('blocks cross-room cid packet injection, close, and cid overwrite', async () => {
    const idA = `peer-a-${Date.now()}`;
    const idB = `peer-b-${Date.now()}`;
    const idC = `peer-c-${Date.now()}`;
    const cid = `cid-${Date.now()}`;

    const a = await connectWs(port);
    const b = await connectWs(port);
    const c = await connectWs(port);

    a.sendJson({ t: 'hello', id: idA });
    b.sendJson({ t: 'hello', id: idB });
    c.sendJson({ t: 'hello', id: idC });
    assert.equal((await a.nextMsg()).t, 'ok');
    assert.equal((await b.nextMsg()).t, 'ok');
    assert.equal((await c.nextMsg()).t, 'ok');

    // A connects to B on cid
    a.sendJson({ t: 'conn', cid, to: idB });
    assert.equal((await a.nextMsg()).t, 'open');
    const bConn = await b.nextMsg();
    assert.equal(bConn.t, 'conn');
    assert.equal(bConn.cid, cid);

    // C tries to overwrite existing cid
    c.sendJson({ t: 'conn', cid, to: idA });
    const cNope = await c.nextMsg();
    assert.equal(cNope.t, 'nopeer');
    assert.equal(cNope.cid, cid);

    // C tries to inject data and close on cid
    c.sendJson({ t: 'd', cid, d: { hacked: true } });
    c.sendJson({ t: 'close', cid });

    // Verify A can still send to B and B receives only A's legitimate packet (not C's)
    a.sendJson({ t: 'd', cid, d: { legit: 1 } });
    const bMsg = await b.nextMsg();
    assert.equal(bMsg.t, 'd');
    assert.deepEqual(bMsg.d, { legit: 1 });

    a.close();
    b.close();
    c.close();
  });

  it('rejects oversized WebSocket frame header without crashing server', async () => {
    const evil = await connectWs(port);
    // Craft masked 64-bit extended length header claiming 1GB payload
    const header = Buffer.allocUnsafe(14);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | 127; // MASK + 64-bit length
    header.writeBigUInt64BE(1_000_000_000n, 2);
    crypto.randomBytes(4).copy(header, 10);

    evil.sendRaw(header);
    await evil.waitClose();

    // Server must still be alive and healthy
    const health = await httpGet(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
  });
});
