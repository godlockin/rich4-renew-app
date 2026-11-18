/**
 * Single-player-only Cheat Mode modal: lets the player inspect and edit every player's
 * money, points, tools, cards, attached god, lands, node position, and global map settings.
 */
import { companyOf, facilityOf, landOf } from '../core/board';
import { playerName } from '../core/characters';
import type { Game } from '../core/game';
import { CARDS, HAND_LIMIT, KB_CARDS, TYCOON_CARDS, cardDef } from '../core/modules/cards';
import { OBJECT_NAMES } from '../core/modules/objects';
import { TOOLS, TYCOON_TOOLS } from '../core/modules/tools';
import { audio } from './audio';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GOD_SLOTS: { slot: number; label: string }[] = [
  { slot: 0, label: '無神仙' },
  { slot: 1, label: OBJECT_NAMES[1] },
  { slot: 2, label: OBJECT_NAMES[2] },
  { slot: 3, label: OBJECT_NAMES[3] },
  { slot: 4, label: OBJECT_NAMES[4] },
  { slot: 5, label: OBJECT_NAMES[5] },
  { slot: 6, label: OBJECT_NAMES[6] },
  { slot: 7, label: OBJECT_NAMES[7] },
  { slot: 8, label: OBJECT_NAMES[8] },
  { slot: 9, label: OBJECT_NAMES[9] },
  { slot: 10, label: OBJECT_NAMES[10] },
  { slot: 11, label: OBJECT_NAMES[11] },
  { slot: 12, label: OBJECT_NAMES[12] },
  { slot: 15, label: OBJECT_NAMES[15] },
];

export function openCheatModal(parent: HTMLElement, game: Game, onApplied: () => void): void {
  let pid = Math.max(0, game.current);
  let tab: 'player' | 'items' | 'lands' | 'world' = 'player';
  let landFilter = '';

  const overlay = document.createElement('div');
  overlay.className = 'slots-overlay';
  const box = document.createElement('div');
  box.className = 'msg sheet wide';
  box.style.maxWidth = '780px';
  box.style.maxHeight = '90vh';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  overlay.append(box);

  const allCards = [...CARDS, ...TYCOON_CARDS, ...KB_CARDS];
  const allTools = game.world ? [...TOOLS, ...TYCOON_TOOLS] : [...TOOLS];

  const close = () => {
    onApplied();
    overlay.remove();
  };

  const render = () => {
    const p = game.players[pid] ?? game.players[0];
    pid = p.id;
    const godSlot = p.god > 0 ? game.objects.slots[p.god - 1] : undefined;
    const godLife = godSlot?.life ?? 5;

    let body = '';
    if (tab === 'player') {
      body = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;text-align:left">
        <div style="background:rgba(255,255,255,.1);padding:10px;border-radius:10px">
          <h4 style="margin:0 0 8px">金錢與點券</h4>
          ${(['cash', 'bank', 'loan', 'points'] as const).map(k => {
            const labels = { cash: '現金', bank: '存款', loan: '貸款', points: '點券' };
            return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;font-size:13px">
              <span>${labels[k]}</span>
              <div style="display:flex;gap:4px;align-items:center">
                <input type="number" data-num="${k}" value="${p[k]}" style="width:96px;padding:3px 6px;border-radius:6px;border:none;background:#fff;color:#222">
                <button class="chip" data-add="${k}" data-v="${k === 'points' ? 100 : 10000}">${k === 'points' ? '+100' : '+1萬'}</button>
                <button class="chip" data-set="${k}" data-v="0">歸0</button>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div style="background:rgba(255,255,255,.1);padding:10px;border-radius:10px">
          <h4 style="margin:0 0 8px">神仙、位置與狀態</h4>
          <label style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;font-size:13px">
            <span>附身神仙</span>
            <select data-god="1" style="padding:3px 6px;border-radius:6px">
              ${GOD_SLOTS.map(g => `<option value="${g.slot}"${p.god === g.slot ? ' selected' : ''}>${esc(g.label)}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;font-size:13px">
            <span>神仙天數</span>
            <input type="number" min="1" max="99" value="${godLife}" data-godlife="1" ${p.god === 0 ? 'disabled' : ''} style="width:76px;padding:3px 6px;border-radius:6px;border:none;background:#fff;color:#222">
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;font-size:13px">
            <span>傳送位置</span>
            <select data-node="1" style="max-width:190px;padding:3px 6px;border-radius:6px">
              ${game.board.nodes.map(n => {
                const nm = landOf(game.board, n)?.name ?? facilityOf(game.board, n)?.name ?? companyOf(game.board, n)?.name ?? `格${n.id}`;
                return `<option value="${n.id}"${p.node === n.id ? ' selected' : ''}>#${n.id} ${esc(nm)}</option>`;
              }).join('')}
            </select>
          </label>
          <label style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;font-size:13px">
            <span>交通工具</span>
            <select data-traffic="1" style="padding:3px 6px;border-radius:6px">
              <option value="0"${(p.traffic & 3) === 0 ? ' selected' : ''}>步行 (1骰)</option>
              <option value="1"${(p.traffic & 3) === 1 ? ' selected' : ''}>機車 (2骰)</option>
              <option value="2"${(p.traffic & 3) === 2 ? ' selected' : ''}>汽車 (3骰)</option>
            </select>
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            <button class="chip" data-clearstatus="1">清除異常狀態 (住院/坐牢/睡眠)</button>
            ${p.bankrupt ? '<button class="chip on" data-revive="1">復活此角色</button>' : ''}
          </div>
        </div>
      </div>`;
    } else if (tab === 'items') {
      body = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;text-align:left">
        <div style="background:rgba(255,255,255,.1);padding:10px;border-radius:10px">
          <h4 style="margin:0 0 8px">道具調整 (0..9)</h4>
          <div style="max-height:260px;overflow-y:auto;display:grid;gap:4px">
            ${allTools.map(t => {
              const cnt = p.tools[t.id - 1] ?? 0;
              return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
                <span>${esc(t.name)}</span>
                <span style="display:flex;align-items:center;gap:4px">
                  <button class="chip" data-tool="${t.id}" data-d="-1">-</button>
                  <b style="min-width:18px;text-align:center">${cnt}</b>
                  <button class="chip" data-tool="${t.id}" data-d="1">+</button>
                  <button class="chip" data-tool="${t.id}" data-d="9">滿</button>
                </span>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div style="background:rgba(255,255,255,.1);padding:10px;border-radius:10px">
          <h4 style="margin:0 0 8px">卡片調整 (${p.cards.length}/${HAND_LIMIT})</h4>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <select data-addcard-sel="1" style="flex:1;padding:4px 6px;border-radius:6px">
              ${allCards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
            <button class="candy yes" data-addcard="1" style="padding:4px 12px;font-size:13px">加入</button>
          </div>
          <div style="max-height:220px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px">
            ${p.cards.length ? p.cards.map((cid, idx) => `<button class="chip" data-rmcard="${idx}" title="點擊移除">${esc(cardDef(cid)?.name ?? `#${cid}`)} ✕</button>`).join('') : '<span style="opacity:.7;font-size:13px">目前沒有卡片</span>'}
          </div>
        </div>
      </div>`;
    } else if (tab === 'lands') {
      const q = landFilter.trim().toLowerCase();
      const lands = game.board.lands.filter(l => !q || l.name.toLowerCase().includes(q));
      body = `<div style="text-align:left">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input type="text" placeholder="搜尋地名..." value="${esc(landFilter)}" data-landfilter="1" style="flex:1;padding:5px 8px;border-radius:8px;border:none;background:#fff;color:#222">
          <span style="font-size:12px;opacity:.85">共 ${lands.length} 塊地產</span>
        </div>
        <div style="max-height:280px;overflow-y:auto;display:grid;gap:5px">
          ${lands.map(l => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(255,255,255,.09);padding:5px 8px;border-radius:8px;font-size:13px">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name)}</span>
            <select data-land-owner="${l.id}" style="padding:2px 6px;border-radius:6px">
              <option value="0"${l.owner === 0 ? ' selected' : ''}>無主空地</option>
              ${game.players.map(pl => `<option value="${pl.id + 1}"${l.owner === pl.id + 1 ? ' selected' : ''}>${esc(playerName(pl))}</option>`).join('')}
            </select>
            <select data-land-lvl="${l.id}" style="padding:2px 6px;border-radius:6px">
              ${[0, 1, 2, 3, 4, 5].map(lv => `<option value="${lv}"${l.level === lv ? ' selected' : ''}>Lv.${lv}</option>`).join('')}
            </select>
          </div>`).join('')}
        </div>
      </div>`;
    } else {
      body = `<div style="background:rgba(255,255,255,.1);padding:12px;border-radius:10px;text-align:left;display:grid;gap:10px">
        <h4 style="margin:0">地圖與全域數值</h4>
        <label style="display:flex;align-items:center;justify-content:space-between;font-size:14px">
          <span>物價指數（目前 ${game.priceIndex}）</span>
          <input type="number" min="1" max="50" value="${game.priceIndex}" data-priceidx="1" style="width:90px;padding:4px 8px;border-radius:6px;border:none;background:#fff;color:#222">
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;font-size:14px">
          <span>樂透獎池（目前 ${game.lotteryPool.toLocaleString()}）</span>
          <input type="number" min="0" step="10000" value="${game.lotteryPool}" data-lottery="1" style="width:120px;padding:4px 8px;border-radius:6px;border:none;background:#fff;color:#222">
        </label>
      </div>`;
    }

    box.innerHTML = `<div class="ribbon">單人作弊模式</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:8px">
        ${game.players.map(pl => `<button class="chip${pl.id === pid ? ' on' : ''}" data-pid="${pl.id}">${esc(playerName(pl))}${pl.id === game.current ? ' (當前回合)' : ''}${pl.bankrupt ? ' [破產]' : ''}</button>`).join('')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:10px">
        <button class="chip${tab === 'player' ? ' on' : ''}" data-tab="player">金錢 / 神仙 / 傳送</button>
        <button class="chip${tab === 'items' ? ' on' : ''}" data-tab="items">道具 / 卡片</button>
        <button class="chip${tab === 'lands' ? ' on' : ''}" data-tab="lands">地產編輯</button>
        <button class="chip${tab === 'world' ? ' on' : ''}" data-tab="world">地圖全域</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;padding:2px">${body}</div>
      <div class="choices" style="margin-top:10px">
        <button class="candy yes" data-done="1">套用並關閉</button>
      </div>`;

    box.onchange = e => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && el.dataset.num) {
        const k = el.dataset.num as 'cash' | 'bank' | 'loan' | 'points';
        p[k] = Math.max(0, Math.floor(Number(el.value || 0)));
        onApplied();
      } else if (el instanceof HTMLSelectElement && el.dataset.god) {
        const slot = Number(el.value);
        game.objects.detachAll(p);
        if (slot > 0) {
          p.god = slot;
          const s = game.objects.slots[slot - 1];
          if (s) { s.owner = p.id + 1; s.node = 0; s.life = Math.max(1, s.life || 5); }
        }
        onApplied();
        render();
      } else if (el instanceof HTMLInputElement && el.dataset.godlife) {
        if (p.god > 0 && game.objects.slots[p.god - 1]) {
          game.objects.slots[p.god - 1].life = Math.max(1, Math.min(99, Math.floor(Number(el.value || 1))));
          onApplied();
        }
      } else if (el instanceof HTMLSelectElement && el.dataset.node) {
        const nid = Number(el.value);
        p.node = nid;
        p.lastNode = nid;
        onApplied();
      } else if (el instanceof HTMLSelectElement && el.dataset.traffic) {
        const tv = Number(el.value);
        p.traffic = tv === 0 ? 0 : tv | (30 << 2);
        onApplied();
      } else if (el instanceof HTMLSelectElement && el.dataset.landOwner) {
        const lid = Number(el.dataset.landOwner);
        const land = game.board.lands.find(l => l.id === lid);
        if (land) { land.owner = Number(el.value); onApplied(); }
      } else if (el instanceof HTMLSelectElement && el.dataset.landLvl) {
        const lid = Number(el.dataset.landLvl);
        const land = game.board.lands.find(l => l.id === lid);
        if (land) { land.level = Number(el.value); onApplied(); }
      } else if (el instanceof HTMLInputElement && el.dataset.priceidx) {
        game.priceIndex = Math.max(1, Math.min(50, Math.floor(Number(el.value || 1))));
        onApplied();
      } else if (el instanceof HTMLInputElement && el.dataset.lottery) {
        game.lotteryPool = Math.max(0, Math.floor(Number(el.value || 0)));
        onApplied();
      }
    };

    box.oninput = e => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && el.dataset.landfilter) {
        landFilter = el.value;
        render();
        const inp = box.querySelector<HTMLInputElement>('[data-landfilter]');
        if (inp) { inp.focus(); inp.setSelectionRange(landFilter.length, landFilter.length); }
      }
    };

    box.onclick = e => {
      const t = e.target as HTMLElement;
      const btn = t.closest('button') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.done) { audio.ui('yes'); close(); return; }
      if (btn.dataset.pid !== undefined) { audio.ui('click'); pid = Number(btn.dataset.pid); render(); return; }
      if (btn.dataset.tab) { audio.ui('click'); tab = btn.dataset.tab as typeof tab; render(); return; }
      if (btn.dataset.add) {
        const k = btn.dataset.add as 'cash' | 'bank' | 'loan' | 'points';
        p[k] += Number(btn.dataset.v || 0);
        audio.ui('click'); onApplied(); render(); return;
      }
      if (btn.dataset.set) {
        const k = btn.dataset.set as 'cash' | 'bank' | 'loan' | 'points';
        p[k] = Number(btn.dataset.v || 0);
        audio.ui('click'); onApplied(); render(); return;
      }
      if (btn.dataset.clearstatus) {
        p.hospital = 0; p.prison = 0; p.sleep = 0; p.sleepwalk = 0; p.stay = 0; p.turtle = 0; p.hotel = 0;
        audio.ui('yes'); onApplied(); render(); return;
      }
      if (btn.dataset.revive) {
        p.bankrupt = false; p.placed = true;
        if (p.cash <= 0) p.cash = 10000;
        audio.ui('yes'); onApplied(); render(); return;
      }
      if (btn.dataset.tool) {
        const tid = Number(btn.dataset.tool);
        const d = Number(btn.dataset.d || 0);
        const cur = p.tools[tid - 1] ?? 0;
        p.tools[tid - 1] = d === 9 ? 9 : Math.max(0, Math.min(9, cur + d));
        audio.ui('click'); onApplied(); render(); return;
      }
      if (btn.dataset.addcard) {
        const sel = box.querySelector<HTMLSelectElement>('[data-addcard-sel]');
        if (sel && p.cards.length < HAND_LIMIT) {
          p.cards.push(Number(sel.value));
          audio.ui('yes'); onApplied(); render();
        }
        return;
      }
      if (btn.dataset.rmcard !== undefined) {
        const idx = Number(btn.dataset.rmcard);
        if (idx >= 0 && idx < p.cards.length) {
          p.cards.splice(idx, 1);
          audio.ui('no'); onApplied(); render();
        }
      }
    };
  };

  overlay.onclick = e => {
    if (e.target === overlay) { audio.ui('no'); close(); }
  };
  render();
  parent.append(overlay);
}
