/**
 * 銀行與特別融資模組（從 core/game.ts 拆出）：負責 ATM 存取、銀行櫃檯借貸、
 * 特別融資額度/準備金檢查/經營權易主追繳，以及月結 10% 銀行利息結算。
 */
import { companyOf } from '../board';
import { CHARACTERS } from '../characters';
import { addDays, day as dayOf, daysBetween, weekday } from '../date';
import { ask, type Flow } from '../flow';
import type { Game, MonthReport } from '../game';
import type { Player } from '../types';
import { isMarketHoliday } from './holidays';

export class Finance {
  constructor(private readonly g: Game) {}

  /**
   * 公平金融模式：派對模式預設開啟（可由 settings.fairFinance 顯式覆蓋）。
   * 開啟後「特別融資」餘額不再參與月結 10% 利息計算，防止利用原版 #13 漏洞刷錢。
   */
  get fairFinance(): boolean {
    return this.g.settings.fairFinance ?? !!this.g.settings.party;
  }

  /** 計算玩家當月可計息的存款基數。 */
  interestBase(p: Player): number {
    if (p.loan !== 0) return 0;
    return this.fairFinance ? Math.max(0, p.bank - p.specialFinance) : p.bank;
  }

  /** 月末銀行結算（10% 存款利息與月結報表）。 */
  *monthlySettlement(): Flow {
    const g = this.g;
    const rows = g.living().map(p => {
      const base = this.interestBase(p);
      return {
        p: p.id,
        character: p.character,
        bank: p.bank,
        loan: p.loan !== 0,
        interest: p.loan ? 0 : Math.trunc(base * 0.1),
      };
    });
    for (const p of g.players) {
      if (!p.whoPlays || p.loan !== 0) continue;
      const base = this.interestBase(p);
      if (this.fairFinance) {
        p.bank += Math.trunc(base * 0.1);
      } else {
        p.bank = Math.trunc(p.bank * 1.1);
      }
    }
    if (!g.rules?.chipsOnly) {
      yield { t: 'fx', kind: 'month-report', data: this.monthReport(rows) as unknown as Record<string, unknown> };
    }
    for (const p of g.players) {
      p.monthLoss = 0;
      p.monthGain = 0;
      p.monthBadDays = 0;
    }
  }

  /** 月結報表（本月悲情人物與本月冠軍）。 */
  monthReport(rows: Omit<MonthReport['rows'][number], 'after'>[]): MonthReport {
    const g = this.g;
    const list = rows.map(r => g.players[r.p]);
    const score = list.map(p => ((p.monthLoss - p.monthGain) + Math.imul(Math.imul(p.monthBadDays & 0xff, g.priceIndex), 2500) + Math.imul(p.luckBad, 10)) | 0);
    let top = 0, at = 0;
    score.forEach((v, i) => { if (v > top) { top = v; at = i; } });
    const second = score.reduce((m, v) => (v !== top && v > m ? v : m), 0);
    const unlucky = top !== 0 && second !== 0 && (top - second) / top > 0.4 ? at : -1;
    let best = 0, champion = 0;
    list.forEach((p, i) => { const w = g.wealth(p); if (w > best) { best = w; champion = i; } });
    const u = list[unlucky], c = list[champion];
    return {
      rows: rows.map(r => ({ ...r, after: g.players[r.p].bank })),
      unlucky,
      champion,
      animation: g.animation,
      unluckyStats: u ? { loss: u.monthLoss, gain: u.monthGain, badDays: u.monthBadDays & 0xff } : null,
      championStats: c ? { cash: c.cash, bank: c.bank, wealth: g.wealth(c) } : null,
    };
  }

  /** 提款機 ATM（經過或停留觸發）。 */
  *atm(p: Player): Flow {
    const g = this.g;
    if (g.rules?.chipsOnly) return;
    if (p.bankRefused) {
      if (g.isHuman(p)) yield* g.say(p.id, `銀行拒絕往來還剩${(p.bankRefused & 0x7f) + 1}天`);
      return;
    }
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'bank', p: p.id, counter: false, maxLoan: 0, canWithdraw: !p.noLoan, canBorrow: false })) as { deposit?: number; withdraw?: number } | undefined;
      if (a?.deposit) { const x = Math.min(a.deposit, p.cash); p.cash -= x; p.bank += x; }
      if (a?.withdraw && !p.noLoan) {
        const x = Math.min(a.withdraw, p.bank); p.bank -= x; p.cash += x;
        yield { t: 'bank', p: p.id };
        yield* this.financeReserve(p);
        return;
      }
      yield { t: 'bank', p: p.id };
      return;
    }
    if (g.smartAi(p)) { g.smart.atm(p); yield { t: 'bank', p: p.id }; yield* this.financeReserve(p); return; }
    const total = p.cash + p.bank;
    if (total <= 0) return;
    let target = CHARACTERS[p.character].cashRatio / 100;
    const d = dayOf(g.date);
    if (d <= 7) target *= 1.5; else if (d >= 26) target *= 0.5;
    if (target >= 1) target = 0.9; else if (target <= 0) target = 0.1;
    if (Math.abs(p.cash / total - target) < 0.25 && p.cash !== 0) return;
    p.cash = Math.trunc(total * target);
    p.bank = total - p.cash;
    yield { t: 'bank', p: p.id };
    yield* this.financeReserve(p);
  }

  /** 設定貸款到期日（90 天後，遇週日或假日順延）。 */
  setLoanDue(p: Player): void {
    if (p.loanDue) return;
    let due = addDays(this.g.date, 90);
    while (weekday(due) === 0 || (this.g.holidaysEnabled && isMarketHoliday(due, this.g.mapSlot))) {
      due = addDays(due, 1);
    }
    p.loanDue = due;
  }

  /** 銀行櫃檯（借貸、還款與董事長特別融資）。 */
  *bankCounter(p: Player): Flow {
    const g = this.g;
    if (p.bankRefused || g.rules?.noLoans) return;
    const wealth = g.wealth(p);
    const indebted = g.challenge && p.cash < 0;
    if (g.isHuman(p)) {
      const company = companyOf(g.board, g.node(p.node));
      const finance = company && company.controller === p.id + 1 && !indebted ? { total: this.otherDeposits(p), used: p.specialFinance } : undefined;
      // 公平金融模式下，貸款額度扣除已使用的特別融資，避免雙重槓桿放大
      const effectiveWealth = this.fairFinance ? Math.max(0, wealth - p.specialFinance) : wealth;
      const a = (yield ask({ t: 'bank', p: p.id, counter: true, maxLoan: Math.max(0, effectiveWealth - p.loan), canWithdraw: !p.noLoan, canBorrow: !p.noLoan && !indebted, finance })) as
        { borrow?: number; repay?: number; finance?: number; financeRepay?: number } | undefined;
      if (finance && a?.finance && !p.noLoan) {
        const x = Math.min(Math.trunc(a.finance), finance.total - p.specialFinance);
        if (x > 0) { p.bank += x; p.specialFinance += x; }
      }
      if (finance && a?.financeRepay) {
        const x = Math.min(Math.trunc(a.financeRepay), p.specialFinance);
        if (x > 0 && x <= p.cash + p.bank) {
          p.bank -= x;
          if (p.bank < 0) { p.cash += p.bank; p.bank = 0; }
          p.specialFinance -= x;
        }
      }
      if (a?.borrow && !p.noLoan && !indebted) {
        const x = Math.min(a.borrow, Math.max(0, effectiveWealth - p.loan));
        if (x > 0) { p.bank += x; p.loan += x; this.setLoanDue(p); }
      }
      if (a?.repay) {
        const x = Math.min(a.repay, p.loan);
        if (x <= p.cash + p.bank) {
          const fromBank = Math.min(x, p.bank); p.bank -= fromBank; p.cash -= x - fromBank;
          p.loan -= x;
          if (!p.loan) p.loanDue = 0;
        }
      }
      yield { t: 'bank', p: p.id };
      return;
    }
    if (indebted) { yield { t: 'bank', p: p.id }; return; }
    if (g.smartAi(p)) { g.smart.bankCounter(p); yield { t: 'bank', p: p.id }; return; }
    const ch = CHARACTERS[p.character], money = p.cash + p.bank;
    const tycoon = !!g.world;
    if (p.loan) {
      const d = daysBetween(g.date, p.loanDue);
      if (tycoon ? money >= 1.2 * p.loan : 2 * p.loan < p.bank || (d <= 6 && p.cash + p.bank >= 1.1 * p.loan)) {
        yield* g.forcedDebit(p, p.loan);
        p.loan = 0;
        if (tycoon) { p.loanDue = 0; p.loanRenewed = undefined; }
      }
    } else if (g.rng.below(10) !== 0 && p.cash + p.bank >= 30000) {
      // enough money: no loan
    } else if (tycoon && money >= 20000 * g.priceIndex) {
      // 大富豪模式: not short of money: no loan
    } else if (!p.noLoan && ch.loanRatio) {
      let loan = Math.trunc((ch.loanRatio * wealth) / 100);
      if (tycoon) loan = Math.min(loan, Math.max(10000 * g.priceIndex, money));
      if (loan > 0) { p.loan = loan; p.bank += loan; this.setLoanDue(p); }
    }
    yield { t: 'bank', p: p.id };
  }

  /** 其他玩家的銀行存款總額（特別融資上限）。 */
  otherDeposits(p: Player): number {
    return this.g.players.reduce((a, q) => (q.id === p.id ? a : a + q.bank), 0);
  }

  /** 目前銀行的經營者（最後一家 category === 7 的公司董事長）。 */
  bankOperator(): Player | null {
    let op: Player | null = null;
    for (const c of this.g.board.companies) if (c.category === 7 && c.controller) op = this.g.players[c.controller - 1] ?? null;
    return op;
  }

  /** 特別融資準備金檢查：他人存款低於經營者已融資金額時強制墊付。 */
  *financeReserve(p: Player): Flow {
    const g = this.g;
    const op = this.bankOperator();
    if (!op || op.id === p.id || !op.specialFinance) return;
    const deposits = g.players.reduce((a, q) => (q.id === op.id || !q.whoPlays ? a : a + q.bank), 0);
    if (deposits >= op.specialFinance) return;
    const short = op.specialFinance - deposits;
    yield* g.say(undefined, `銀行資金準備\n\n不足${short}元\n\n由經營者${g.name(op.id)}墊付！`);
    yield* g.forcedDebit(op, short);
    op.specialFinance = Math.max(0, op.specialFinance - short);
    yield { t: 'bank', p: op.id };
  }

  /** 銀行經營權易主時強制追繳前任經營者的特別融資。 */
  *financeRecall(): Flow {
    const g = this.g;
    const op = this.bankOperator();
    const ops = g.world ? g.world.hooks.bankOperators() : [];
    for (const q of g.players) {
      if (q === op || ops.includes(q) || !q.whoPlays || !q.specialFinance) continue;
      yield* g.say(undefined, '銀行經營權易主！');
      yield* g.say(undefined, `${g.name(q.id)}\n\n強制償還${q.specialFinance}元\n\n銀行特別融資！`);
      const s = q.specialFinance;
      yield* g.forcedDebit(q, s);
      q.specialFinance = 0;
      yield { t: 'bank', p: q.id };
      if (g.over) return;
    }
  }
}
