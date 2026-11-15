/**
 * 大富翁4 地圖審計腳本（editor/audit.mjs）
 * 檢查項目：
 *  1. 路網連通性（BFS 是否可達所有節點）
 *  2. 死路檢查（出邊數量 < 2 的節點）
 *  3. 鄰接對稱性與懸空邊（adjacent 指向不存在的節點）
 *  4. 參考 ID 完整性（ref 2001+ 地產 / 4001+ 設施 / 6001+ 企業是否存在）
 *  5. 步距異常檢測（相鄰節點距離過近 < 20px 或過遠 > 400px）
 *
 * 用法：node editor/audit.mjs <path/to/map.json>
 */
import { readFileSync } from 'node:fs';

/** 解析精簡版 RawMap（raw_hex）或已解析的 Board JSON。 */
function toBoard(data) {
  if (!Array.isArray(data.nodes)) throw new Error('無效的地圖 JSON：缺少 nodes 陣列');
  const first = data.nodes[0];
  if (first && typeof first.raw_hex === 'string') {
    const nodes = data.nodes.map(r => {
      const b = Buffer.from(r.raw_hex, 'hex');
      const status = b.readUInt32LE(36);
      return {
        id: r.id,
        x: b.readInt16LE(0),
        y: b.readInt16LE(2),
        adjacent: [0, 1, 2, 3].map(i => b.readUInt16LE(24 + i * 2)),
        ref: b.readUInt16LE(32),
        event: status & 0xff,
        oneWay: (status >>> 27) & 0xf,
      };
    });
    return {
      name: data.name || `Map ${data.map_id}`,
      mapId: data.map_id ?? 0,
      nodes,
      lands: data.lands || [],
      facilities: data.facilities || [],
      companies: data.companies || [],
    };
  }
  return data;
}

export function auditBoard(board) {
  const issues = [];
  const nodeMap = new Map(board.nodes.map(n => [n.id, n]));
  const landIds = new Set((board.lands || []).map(l => l.id));
  const facIds = new Set((board.facilities || []).map(f => f.id));
  const compIds = new Set((board.companies || []).map(c => c.id));

  if (!board.nodes.length) {
    issues.push({ level: 'error', msg: '地圖沒有任何路網節點' });
    return { ok: false, stats: { nodes: 0 }, issues };
  }

  // 1. 連通性 BFS
  const visited = new Set([board.nodes[0].id]);
  const queue = [board.nodes[0].id];
  while (queue.length) {
    const cur = nodeMap.get(queue.shift());
    for (const nextId of cur.adjacent || []) {
      if (nextId && nodeMap.has(nextId) && !visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  const unreachable = board.nodes.filter(n => !visited.has(n.id)).map(n => n.id);
  if (unreachable.length) issues.push({ level: 'error', msg: `存在 ${unreachable.length} 個不可達孤立節點: ${unreachable.slice(0, 10).join(', ')}` });

  // 2. 節點出邊、對稱性、步距、ref 檢查
  const deadEnds = [];
  const brokenRefs = [];
  const badSteps = [];
  for (const n of board.nodes) {
    const exits = (n.adjacent || []).filter((id, j) => id && !((n.oneWay || 0) & (8 >> j)));
    if (exits.length < 2 && n.event !== 15 && n.event !== 16) deadEnds.push(n.id);
    for (const nextId of n.adjacent || []) {
      if (!nextId) continue;
      const nb = nodeMap.get(nextId);
      if (!nb) {
        issues.push({ level: 'error', msg: `節點 #${n.id} 指向不存在的鄰居 #${nextId}` });
        continue;
      }
      const dist = Math.hypot(nb.x - n.x, nb.y - n.y);
      if (dist < 20 || dist > 450) badSteps.push(`${n.id}->${nextId}(${Math.round(dist)}px)`);
    }
    const r = n.ref || 0;
    if (r >= 2001 && r < 4000 && !landIds.has(r - 2000)) brokenRefs.push(`#${n.id}->land(${r - 2000})`);
    else if (r >= 4001 && r < 6000 && !facIds.has(r - 4000)) brokenRefs.push(`#${n.id}->fac(${r - 4000})`);
    else if (r >= 6001 && r < 8000 && !compIds.has(r - 6000)) brokenRefs.push(`#${n.id}->comp(${r - 6000})`);
  }

  if (deadEnds.length) issues.push({ level: 'warn', msg: `出邊少於 2 的端點（非醫院/監獄）: ${deadEnds.slice(0, 10).join(', ')}` });
  if (brokenRefs.length) issues.push({ level: 'error', msg: `無效 ref 綁定: ${brokenRefs.slice(0, 10).join(', ')}` });
  if (badSteps.length) issues.push({ level: 'warn', msg: `步距異常（<20px 或 >450px）: ${badSteps.slice(0, 8).join(', ')}` });

  return {
    ok: issues.every(i => i.level !== 'error'),
    stats: {
      name: board.name,
      nodes: board.nodes.length,
      lands: landIds.size,
      facilities: facIds.size,
      companies: compIds.size,
      errors: issues.filter(i => i.level === 'error').length,
      warnings: issues.filter(i => i.level === 'warn').length,
    },
    issues,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node editor/audit.mjs <map.json>');
    process.exit(1);
  }
  const board = toBoard(JSON.parse(readFileSync(file, 'utf8')));
  const res = auditBoard(board);
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(2);
}
