import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { GameEvent, GameSettings } from '../types';
import {
  HOLIDAY_TABLES,
  holidayGiftCard,
  holidayName,
  isHoliday,
  isMarketHoliday,
  lookupHoliday,
} from './holidays';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMap0 = existsSync(mapFile(0));

function newMap0Game(startDate: number, holidays: boolean): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(0), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 0,
    players: [
      { character: 0, human: false },
      { character: 4, human: false },
    ],
    fundIndex: 1,
    traffic: 0,
    landLimitIndex: 0,
    daysLimitIndex: 0,
    victoryIndex: 0,
    startDate,
    seed: 42,
    holidays,
  };
  const g = new Game(settings, board);
  const road = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref))!;
  for (const p of g.players) {
    p.placed = true;
    p.whoPlays = 2;
    p.node = road.id;
    p.lastNode = road.adjacent.find(Boolean)!;
  }
  return g;
}

function drain(flow: Flow): GameEvent[] {
  const events: GameEvent[] = [];
  for (let r = flow.next(); !r.done; r = flow.next()) {
    if (!('ask' in r.value)) events.push(r.value);
  }
  return events;
}

describe('holidays module', () => {
  it('defines 8 map-slot tables with at most 24 entries each', () => {
    expect(HOLIDAY_TABLES).toHaveLength(8);
    for (const table of HOLIDAY_TABLES) {
      expect(table.length).toBeGreaterThan(0);
      expect(table.length).toBeLessThanOrEqual(24);
    }
  });

  it('matches fixed Gregorian holidays via both PackedDate and (month, day) signatures', () => {
    expect(isHoliday(pack(2026, 10, 10), 0)).toBe(true);
    expect(holidayName(pack(2026, 10, 10), 0)).toBe('國慶日');
    expect(isHoliday(10, 10, 0)).toBe(true);
    expect(holidayName(10, 10, 0)).toBe('國慶日');

    expect(holidayName(10, 1, 1)).toBe('國慶節');
    expect(holidayName(11, 3, 2)).toBe('文化の日');
    expect(holidayName(7, 4, 3)).toBe('Independence Day');
    expect(isHoliday(pack(2026, 10, 10), 3)).toBe(false);
    expect(isHoliday(pack(2026, 12, 25), 1000)).toBe(false);
  });

  it('matches Nth-weekday holidays accurately', () => {
    // 2026-05-10 is the 2nd Sunday of May 2026
    expect(holidayName(pack(2026, 5, 10), 0)).toBe('母親節');
    expect(isMarketHoliday(pack(2026, 5, 10), 0)).toBe(false);
    expect(holidayName(pack(2026, 5, 17), 0)).toBeNull();

    // 2026-11-26 is the 4th Thursday of November 2026
    expect(holidayName(pack(2026, 11, 26), 3)).toBe('Thanksgiving');
    expect(isMarketHoliday(pack(2026, 11, 26), 3)).toBe(true);
  });

  it('matches lunar holidays and 除夕 across both 29-day and 30-day 12th lunar months', () => {
    // 2026 Spring Festival is 2026-02-17 (12th lunar month of 2025 has 29 days)
    expect(holidayName(pack(2026, 2, 16), 0)).toBe('除夕');
    expect(holidayGiftCard(pack(2026, 2, 16), 0)).toBe(true);
    expect(holidayName(pack(2026, 2, 17), 0)).toBe('春節');
    expect(holidayName(pack(2026, 2, 18), 0)).toBe('春節初二');
    expect(holidayName(pack(2026, 2, 19), 0)).toBe('春節初三');
    expect(holidayName(pack(2026, 2, 17), 2)).toBeNull();

    // 2027 Spring Festival is 2027-02-07 (12th lunar month of 2026 has 30 days)
    expect(holidayName(pack(2027, 2, 6), 1)).toBe('除夕');
    expect(holidayName(pack(2027, 2, 7), 1)).toBe('春節');
  });

  it('handles maps 4..7 gift-card-only entries without closing the market', () => {
    const dec25 = pack(2026, 12, 25);
    expect(lookupHoliday(dec25, 4)).toMatchObject({ name: '聖誕節', rest: false, giftCard: true });
    expect(isMarketHoliday(dec25, 4)).toBe(false);
    expect(holidayGiftCard(dec25, 4)).toBe(true);

    const eve2026 = pack(2026, 2, 16);
    expect(lookupHoliday(eve2026, 5)).toMatchObject({ name: '除夕', rest: false, giftCard: true });
    expect(isMarketHoliday(eve2026, 5)).toBe(false);
  });
});

describe.skipIf(!haveMap0)('holidays integration', () => {
  it('closes the stock market on market holidays when holidays are enabled', () => {
    // 2026-10-10 is Saturday (國慶日 on map 0, rest: true)
    const withHolidays = newMap0Game(pack(2026, 10, 10), true);
    expect(withHolidays.stocks.open()).toBe(false);

    // 2026-10-09 is Friday (normal day)
    const openDay = newMap0Game(pack(2026, 10, 9), true);
    expect(openDay.stocks.open()).toBe(true);

    // 2026-02-14 is Saturday (情人節 on map 0, rest: false) -> market stays open
    const nonRestHoliday = newMap0Game(pack(2026, 2, 14), true);
    expect(nonRestHoliday.stocks.open()).toBe(true);

    // Without holidays enabled, 2026-10-10 Saturday stays open
    const withoutHolidays = newMap0Game(pack(2026, 10, 10), false);
    expect(withoutHolidays.stocks.open()).toBe(true);
  });

  it('postpones loan due dates past both Sundays and market holidays', () => {
    // 90 days after 2026-07-12 is 2026-10-10 (Saturday 國慶日), followed by 2026-10-11 (Sunday)
    const gHolidays = newMap0Game(pack(2026, 7, 12), true);
    gHolidays.finance.setLoanDue(gHolidays.players[0]);
    expect(gHolidays.players[0].loanDue).toBe(pack(2026, 10, 12));

    const gClassic = newMap0Game(pack(2026, 7, 12), false);
    gClassic.finance.setLoanDue(gClassic.players[0]);
    expect(gClassic.players[0].loanDue).toBe(pack(2026, 10, 10));
  });

  it('gifts 1 random card to each living player on gift-card holidays in dailySettlement', () => {
    const g = newMap0Game(pack(2026, 12, 24), true);
    g.players[1].bankrupt = true;
    g.players[1].whoPlays = 0;

    const events = drain(g.dailySettlement());
    expect(g.date).toBe(pack(2026, 12, 25));
    expect(events).toContainEqual({ t: 'holiday', name: '聖誕節', rest: true, giftCard: true });
    expect(g.players[0].cards).toHaveLength(1);
    expect(g.players[1].cards).toHaveLength(0);

    // Disabled by default: no holiday event or gift card
    const gOff = newMap0Game(pack(2026, 12, 24), false);
    const eventsOff = drain(gOff.dailySettlement());
    expect(eventsOff.some(e => e.t === 'holiday')).toBe(false);
    expect(gOff.players[0].cards).toHaveLength(0);
  });
});
