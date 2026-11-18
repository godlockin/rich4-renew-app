/**
 * Player-to-player free trade modal (core/modules/trade.ts).
 */
import { playerName } from '../core/characters';
import type { Game } from '../core/game';
import { cardDef } from '../core/modules/cards';
import { executeTrade, validateTrade, type ShareTransfer, type TradeOffer } from '../core/modules/trade';
import { audio } from './audio';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Opens a modal to compose and validate a `TradeOffer` from `fromId` to a chosen living opponent. */
export function openTradeModal(parent: HTMLElement, game: Game, fromId: number): Promise<TradeOffer | null> {
  const fromP = game.players[fromId];
  const opponents = game.players.filter(p => !p.bankrupt && p.id !== fromId);
  if (!fromP || fromP.bankrupt || !opponents.length) return Promise.resolve(null);

  return new Promise(resolve => {
    let toId = opponents[0].id;
    const overlay = document.createElement('div');
    overlay.className = 'slots-overlay';
    const box = document.createElement('div');
    box.className = 'msg sheet wide';
    box.style.maxWidth = '720px';
    box.style.maxHeight = '90vh';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    overlay.append(box);

    const finish = (offer: TradeOffer | null) => {
      overlay.remove();
      resolve(offer);
    };

    const render = () => {
      const toP = game.players[toId];
      const landsOf = (pid: number) => game.board.lands.filter(l => l.owner === pid + 1);
      const sharesOf = (pid: number) => {
        const out: { company: number; name: string; have: number }[] = [];
        const stocks = game.stocks.stocks;
        for (let i = 0; i < stocks.length; i++) {
          const have = game.stocks.holding(pid, i).shares;
          if (have > 0) out.push({ company: i, name: stocks[i].name, have });
        }
        return out;
      };

      const sideHtml = (side: 'from' | 'to', p: typeof fromP) => {
        const lands = landsOf(p.id);
        const shares = sharesOf(p.id);
        return `<div style="flex:1;min-width:240px;background:rgba(255,255,255,.1);border-radius:12px;padding:10px;text-align:left">
          <h4 style="margin:0 0 8px">${side === 'from' ? `我方（${esc(playerName(p))}）提供` : `對方（${esc(playerName(p))}）提供`}</h4>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:13px">
            現金（現有 ${p.cash.toLocaleString()}）：
            <input type="number" min="0" max="${Math.max(0, p.cash)}" step="1000" value="0" data-cash="${side}" style="width:110px;padding:3px 6px;border-radius:6px;border:1px solid #fff6;background:#fff;color:#222">
          </label>
          <div style="margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">地產（${lands.length}）</div>
            <div style="max-height:110px;overflow-y:auto;display:grid;gap:3px;font-size:12px">
              ${lands.length ? lands.map(l => `<label style="display:flex;align-items:center;gap:5px"><input type="checkbox" data-land="${side}" value="${l.id}">${esc(l.name)}（Lv.${l.level}）</label>`).join('') : '<span style="opacity:.7">無地產</span>'}
            </div>
          </div>
          <div style="margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">卡片（${p.cards.length}）</div>
            <div style="max-height:110px;overflow-y:auto;display:grid;gap:3px;font-size:12px">
              ${p.cards.length ? p.cards.map((cid, idx) => `<label style="display:flex;align-items:center;gap:5px"><input type="checkbox" data-card="${side}" data-idx="${idx}" value="${cid}">${esc(cardDef(cid)?.name ?? `卡#${cid}`)}</label>`).join('') : '<span style="opacity:.7">無卡片</span>'}
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:700;margin-bottom:4px">股票</div>
            <div style="max-height:90px;overflow-y:auto;display:grid;gap:4px;font-size:12px">
              ${shares.length ? shares.map(s => `<label style="display:flex;align-items:center;justify-content:space-between;gap:6px"><span>${esc(s.name)}（${s.have}股）</span><input type="number" min="0" max="${s.have}" value="0" data-share="${side}" data-company="${s.company}" style="width:72px;padding:2px 4px;border-radius:6px;border:1px solid #fff6;background:#fff;color:#222"></label>`).join('') : '<span style="opacity:.7">無持股</span>'}
            </div>
          </div>
        </div>`;
      };

      box.innerHTML = `<div class="ribbon">自由交易</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;font-size:14px">
          <span>交易對象：</span>
          <select data-to="1" style="padding:4px 10px;border-radius:8px;font-size:14px">
            ${opponents.map(o => `<option value="${o.id}"${o.id === toId ? ' selected' : ''}>${esc(playerName(o))}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;overflow-y:auto;min-height:0;flex:1;padding:2px">
          ${sideHtml('from', fromP)}
          ${sideHtml('to', toP)}
        </div>
        <p data-status="1" style="margin:8px 0 4px;font-size:13px;min-height:1.3em;color:#ffe680"></p>
        <div class="choices">
          <button class="candy ghost" data-cancel="1">取消</button>
          <button class="candy yes" data-ok="1" disabled>確定交易</button>
        </div>`;

      const collectOffer = (): TradeOffer => {
        const num = (sel: string) => Math.max(0, Math.floor(Number(box.querySelector<HTMLInputElement>(sel)?.value || 0)));
        const lands = (side: 'from' | 'to') => [...box.querySelectorAll<HTMLInputElement>(`input[data-land="${side}"]:checked`)].map(el => Number(el.value));
        const cards = (side: 'from' | 'to') => [...box.querySelectorAll<HTMLInputElement>(`input[data-card="${side}"]:checked`)].map(el => Number(el.value));
        const shares = (side: 'from' | 'to'): ShareTransfer[] => [...box.querySelectorAll<HTMLInputElement>(`input[data-share="${side}"]`)]
          .map(el => ({ company: Number(el.dataset.company), amount: Math.max(0, Math.floor(Number(el.value || 0))) }))
          .filter(s => s.amount > 0);
        return {
          from: fromId,
          to: toId,
          cashFrom: num('input[data-cash="from"]'),
          cashTo: num('input[data-cash="to"]'),
          landsFrom: lands('from'),
          landsTo: lands('to'),
          cardsFrom: cards('from'),
          cardsTo: cards('to'),
          sharesFrom: shares('from'),
          sharesTo: shares('to'),
        };
      };

      const refreshStatus = () => {
        const offer = collectOffer();
        const hasAny = (offer.cashFrom ?? 0) > 0 || (offer.cashTo ?? 0) > 0
          || (offer.landsFrom?.length ?? 0) > 0 || (offer.landsTo?.length ?? 0) > 0
          || (offer.cardsFrom?.length ?? 0) > 0 || (offer.cardsTo?.length ?? 0) > 0
          || (offer.sharesFrom?.length ?? 0) > 0 || (offer.sharesTo?.length ?? 0) > 0;
        const statusEl = box.querySelector<HTMLElement>('[data-status]')!;
        const okBtn = box.querySelector<HTMLButtonElement>('[data-ok]')!;
        if (!hasAny) {
          statusEl.textContent = '請至少選擇一項交易內容';
          okBtn.disabled = true;
          return;
        }
        const v = validateTrade(game, offer);
        statusEl.textContent = v.ok ? '交易條件合法，可送出交易' : v.reason;
        okBtn.disabled = !v.ok;
      };

      box.querySelector<HTMLSelectElement>('[data-to]')!.onchange = e => {
        toId = Number((e.target as HTMLSelectElement).value);
        render();
      };
      box.oninput = () => refreshStatus();
      box.onchange = e => {
        if ((e.target as HTMLElement).matches('[data-to]')) return;
        refreshStatus();
      };
      box.onclick = e => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-cancel]')) { audio.ui('no'); finish(null); return; }
        if (t.closest('[data-ok]')) {
          const offer = collectOffer();
          if (validateTrade(game, offer).ok) {
            audio.ui('yes');
            finish(offer);
          }
        }
      };
      refreshStatus();
    };

    overlay.onclick = e => {
      if (e.target === overlay) { audio.ui('no'); finish(null); }
    };
    render();
    parent.append(overlay);
  });
}

export { executeTrade };
