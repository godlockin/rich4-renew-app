import { describe, expect, it } from 'vitest';
import type { Board, BoardNode, Facility, Land } from '../board';
import { CHARACTERS } from '../characters';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { Answer, GameSettings, Step } from '../types';
import {
  CHARACTER_TRAITS,
  getCharacterTrait,
  traitBankInterestBonus,
  traitBuildCost,
  traitBuyLandCost,
  traitCardShopRebate,
  traitDividendBonus,
  traitEventPointsBonus,
  traitMonthlyAllowance,
  traitPointsAmount,
  traitStartingPoints,
  traitStepBonus,
  traitTaxAmount,
  traitTollIncome,
  traitTollPay,
} from './traits';

function makeTestBoard(): Board {
  const nodes: BoardNode[] = [];
  for (let i = 1; i <= 16; i++) {
    const prev = i === 1 ? 16 : i - 1;
    const next = i === 16 ? 1 : i + 1;
    nodes.push({
      id: i,
      x: i * 100,
      y: 100,
      adjacent: [next, prev, 0, 0],
      ref: i <= 4 ? 2000 + i : i === 5 ? 4001 : 0,
      aux: 0,
      event: i === 6 ? 10 : i === 7 ? 15 : i === 8 ? 2 : 0,
      oneWay: 0,
      noDrop: false,
    });
  }
  const lands: Land[] = [1, 2, 3, 4].map(id => ({
    id,
    x: id * 100,
    y: 100,
    name: `測試街${id}`,
    tmpState: 0,
    chain: false,
    owner: 0,
    level: 0,
    facing: 0,
    price: 1000,
    perLevel: 500,
    tolls: [200, 400, 800, 1600, 3200, 6400],
    lastToll: 0,
    expire: 0,
  }));
  const facilities: Facility[] = [
    {
      id: 1,
      x: 500,
      y: 100,
      name: '測試大型地',
      type: 1,
      owner: 0,
      level: 0,
      tmpState: 0,
      labTool: 0,
      labDays: 0,
      price: 2000,
      fees: [1000, 500, 1000, 1500, 2000, 2500],
      lastFee: 0,
      expire: 0,
    },
  ];
  return {
    name: 'TestBoard',
    mapId: 0,
    nodes,
    lands,
    facilities,
    companies: [],
    landscapes: [],
  };
}

function makeGame(characters: number[], traits: boolean, extra: Partial<GameSettings> = {}): Game {
  const settings: GameSettings = {
    mapId: 0,
    players: characters.map((character, i) => ({ character, human: i === 0 })),
    fundIndex: 1,
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate: pack(2026, 10, 31),
    seed: 1234,
    traits,
    ...extra,
  };
  const g = new Game(settings, makeTestBoard());
  for (const p of g.players) {
    p.placed = true;
    p.whoPlays = p.human ? 1 : 2;
    p.node = 1;
    p.lastNode = 16;
  }
  return g;
}

function runFlow<T>(flow: Flow<T>, answers: Answer[] = []): Step[] {
  const out: Step[] = [];
  for (let r = flow.next(); !r.done; r = flow.next('ask' in r.value ? answers.shift() : undefined)) {
    out.push(r.value);
  }
  return out;
}

describe('Character Trait Mode (traits.ts)', () => {
  it('defines distinct traits for all 12 characters (0..11)', () => {
    expect(CHARACTER_TRAITS).toHaveLength(CHARACTERS.length);
    const ids = new Set(CHARACTER_TRAITS.map(t => t.id));
    const charIds = new Set(CHARACTER_TRAITS.map(t => t.characterId));
    expect(ids.size).toBe(12);
    expect(charIds.size).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(getCharacterTrait(i)?.characterId).toBe(i);
    }
  });

  it('does not modify values when settings.traits is false or omitted', () => {
    const g = makeGame([4, 3, 1, 9], false);
    const [tu, qian, salonpas, xiaomei] = g.players;
    expect(traitBuildCost(g, tu, 1000)).toBe(1000);
    expect(traitTaxAmount(g, qian, 1000)).toBe(1000);
    expect(traitBankInterestBonus(g, qian)).toBe(0);
    expect(traitTollIncome(g, salonpas, 1000)).toBe(1000);
    expect(traitStepBonus(g, makeGame([2], false).players[0])).toBe(0);
    expect(traitBuyLandCost(g, makeGame([7], false).players[0], 1000)).toBe(1000);
    expect(traitTollPay(g, makeGame([5], false).players[0], 1000)).toBe(1000);
    expect(traitPointsAmount(g, makeGame([6], false).players[0], 50)).toBe(50);
    expect(traitEventPointsBonus(g, makeGame([8], false).players[0])).toBe(0);
    expect(traitDividendBonus(g, makeGame([0], false).players[0], 500)).toBe(0);
    expect(traitStartingPoints(g, makeGame([11], false).players[0])).toBe(0);
    expect(traitMonthlyAllowance(g, makeGame([11], false).players[0])).toBe(0);
    expect(traitCardShopRebate(g, xiaomei, new Map(), 100)).toBe(0);
  });

  it('applies 阿土伯 20% build/upgrade discount in landOnLot and landOnFacility', () => {
    const g = makeGame([4, 0], true);
    const tu = g.players[0];
    tu.cash = 10000;
    const land = g.board.lands[0];
    land.owner = 1;
    land.level = 0;

    runFlow(g.landOnLot(tu, land), [true]);
    // perLevel is 500 -> 20% off = 400
    expect(land.level).toBe(1);
    expect(tu.cash).toBe(9600);

    const fac = g.board.facilities[0];
    fac.owner = 1;
    fac.level = 0;
    runFlow(g.landOnFacility(tu, fac), [1]); // build hotel: price 2000 -> 1600
    expect(fac.level).toBe(1);
    expect(tu.cash).toBe(8000);
  });

  it('applies 錢夫人 +2% bank interest and 50% tax discount', () => {
    const g = makeGame([3, 0], true);
    const [qian, other] = g.players;
    qian.bank = 10000;
    qian.loan = 0;
    other.bank = 10000;
    other.loan = 0;

    // Cross month boundary: 2026-10-31 -> 2026-11-01
    runFlow(g.dailySettlement());
    // Base 10% = 1000, Qian gets +2% = 200 -> 11200; other gets 11000
    expect(qian.bank).toBe(11200);
    expect(other.bank).toBe(11000);

    qian.cash = 5000;
    runFlow(g.transfer(qian.id, -1, 1000, 0, '所得稅', true));
    // 50% tax discount -> pays 500 instead of 1000
    expect(qian.cash).toBe(4500);
  });

  it('applies 沙隆巴斯 +15% toll income and 莎拉公主 15% toll pay discount', () => {
    const g = makeGame([0, 1, 5], true);
    const [john, salonpas, sarah] = g.players;
    john.cash = 10000;
    sarah.cash = 10000;
    salonpas.bank = 0;

    const land = g.board.lands[1];
    land.owner = salonpas.id + 1; // owned by 沙隆巴斯
    land.level = 1; // toll = 400

    // John pays Salonpas: 400 * 1.15 = 460
    runFlow(g.landOnLot(john, land));
    expect(john.cash).toBe(10000 - 460);
    expect(salonpas.bank).toBe(460);

    // Sarah pays Salonpas: 460 * 0.85 = 391
    runFlow(g.landOnLot(sarah, land));
    expect(sarah.cash).toBe(10000 - 391);
    expect(salonpas.bank).toBe(460 + 391);
  });

  it('applies 孫小美 20% card shop discount (rebate)', () => {
    const g = makeGame([9, 0], true);
    const xiaomei = g.players[0];
    xiaomei.points = 500;
    xiaomei.cards = [];
    xiaomei.node = 7; // event 15 (shop)

    // Buy card at index 0, then exit shop
    const steps = runFlow(g.land(xiaomei), [{ buy: 'card', index: 0 }, {} as Answer]);
    expect(xiaomei.cards.length).toBe(1);
    const rebateEvents = steps.filter(s => s.t === 'points' && s.p === xiaomei.id);
    expect(rebateEvents.length).toBe(1);
    const rebate = (rebateEvents[0] as { amount: number }).amount;
    expect(rebate).toBeGreaterThan(0);
    expect(xiaomei.points).toBeGreaterThan(500 - 500);
  });

  it('applies 忍太郎 +1 step on motorcycle and 小丹尼 +2 steps in car', () => {
    const g = makeGame([2, 10], true);
    const [ninja, danny] = g.players;
    ninja.traffic = 1; // motorcycle
    ninja.dice = 1;
    ninja.tools[1] = 1;
    danny.traffic = 2; // car
    danny.dice = 1;

    g.tools.remoteDice = 3;
    const ninjaSteps = runFlow((g as unknown as { depart: (p: typeof ninja) => Flow }).depart(ninja));
    const ninjaMoved = ninjaSteps.filter(s => s.t === 'step').length;
    expect(ninjaMoved).toBe(4); // 3 + 1

    g.tools.remoteDice = 3;
    const dannySteps = runFlow((g as unknown as { depart: (p: typeof danny) => Flow }).depart(danny));
    const dannyMoved = dannySteps.filter(s => s.t === 'step').length;
    expect(dannyMoved).toBe(5); // 3 + 2
  });

  it('applies 金貝貝 starting points +50 & monthly allowance, 宮本寶藏 +25% points, 烏咪 +10 event points, 糖糖 10% land buy discount', () => {
    const g = makeGame([11, 6, 8, 7], true);
    const [beibei, miyamoto, wumi, tang] = g.players;

    // 金貝貝 starting points +50
    expect(beibei.points).toBe(50);

    // 金貝貝 monthly allowance +2000 on newMonth
    const cashBefore = beibei.cash;
    runFlow(g.dailySettlement());
    expect(beibei.cash).toBe(cashBefore + 2000);

    // 宮本寶藏 +25% on 50-point square -> 63
    miyamoto.node = 6; // event 10 (50 points)
    miyamoto.points = 0;
    runFlow(g.land(miyamoto));
    expect(miyamoto.points).toBe(63);

    // 烏咪 +10 points on news square (event 2)
    wumi.node = 8;
    wumi.points = 0;
    runFlow(g.land(wumi));
    expect(wumi.points).toBe(10);

    // 糖糖 10% discount on buying unowned land (price 1000 -> 900)
    tang.cash = 5000;
    const unowned = g.board.lands[2];
    unowned.owner = 0;
    runFlow(g.landOnLot(tang, unowned));
    expect(unowned.owner).toBe(tang.id + 1);
    expect(tang.cash).toBe(4100);
  });
});
