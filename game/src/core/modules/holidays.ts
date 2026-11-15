/**
 * Classic 24-holiday system (docs/rules/01 §4.3-4.4, 06 §10):
 * up to 24 holiday entries per original map slot (0..7), covering fixed Gregorian dates,
 * Chinese lunar dates (including 除夕 / lunar New Year's Eve), and Nth-weekday holidays.
 */
import { addDays, day as dayOf, month as monthOf, pack, weekday as weekdayOf, year as yearOf, type PackedDate } from '../date';

export type HolidayKind = 'solar' | 'lunar' | 'lunarEve' | 'nthWeekday';

export interface HolidayEntry {
  kind: HolidayKind;
  /** 1..12 for solar / lunar / nthWeekday; 0 for lunarEve. */
  month: number;
  /** Day of month (solar / lunar), 1-based occurrence (nthWeekday), or 0 (lunarEve). */
  day: number;
  /** 0 = Sunday .. 6 = Saturday, used when kind === 'nthWeekday'. */
  weekday?: number;
  name: string;
  /** True when the stock market is closed and bank loan due dates postpone past this day. */
  rest: boolean;
  /** True when every living player receives 1 random card at daily settlement (effect bit 3). */
  giftCard: boolean;
  /** Effect bit 0: holiday picture. */
  picture?: boolean;
  /** Effect bit 2: holiday music. */
  music?: boolean;
}

const solar = (month: number, day: number, name: string, rest: boolean, opts?: { giftCard?: boolean; picture?: boolean; music?: boolean }): HolidayEntry => ({
  kind: 'solar', month, day, name, rest, giftCard: !!opts?.giftCard, picture: opts?.picture, music: opts?.music,
});

const lunar = (month: number, day: number, name: string, rest: boolean, opts?: { giftCard?: boolean; music?: boolean }): HolidayEntry => ({
  kind: 'lunar', month, day, name, rest, giftCard: !!opts?.giftCard, music: opts?.music,
});

const lunarEve = (name: string, rest: boolean, giftCard: boolean): HolidayEntry => ({
  kind: 'lunarEve', month: 0, day: 0, name, rest, giftCard,
});

const nth = (month: number, n: number, weekday: number, name: string, rest = false): HolidayEntry => ({
  kind: 'nthWeekday', month, day: n, weekday, name, rest, giftCard: false,
});

/**
 * Holiday tables indexed by `mapSlot` (0..7), matching `0x47ff4a` (max 24 entries per map).
 * Workshop maps (>= 1000) and unmapped ids have no entries.
 */
export const HOLIDAY_TABLES: readonly (readonly HolidayEntry[])[] = [
  // 0: 台灣 (23 entries)
  [
    solar(1, 1, '元旦', true, { picture: true }),
    solar(2, 14, '情人節', false),
    solar(3, 29, '青年節', true),
    solar(4, 1, '愚人節', false),
    solar(4, 4, '兒童節', true),
    solar(4, 5, '清明節', true),
    solar(5, 1, '勞動節', true),
    solar(8, 8, '父親節', false),
    solar(9, 28, '教師節', true),
    solar(10, 10, '國慶日', true, { picture: true }),
    solar(10, 25, '台灣光復節', true),
    solar(10, 31, '蔣公誕辰', true),
    solar(11, 12, '國父誕辰', true),
    solar(12, 25, '聖誕節', true, { picture: true, music: true, giftCard: true }),
    nth(5, 2, 0, '母親節', false),
    lunarEve('除夕', true, true),
    lunar(1, 1, '春節', true, { music: true }),
    lunar(1, 2, '春節初二', true, { music: true }),
    lunar(1, 3, '春節初三', true, { music: true }),
    lunar(1, 15, '元宵節', false),
    lunar(5, 5, '端午節', true),
    lunar(7, 15, '中元節', false),
    lunar(8, 15, '中秋節', true),
  ],
  // 1: 中國大陸 (23 entries)
  [
    solar(1, 1, '元旦', true, { picture: true }),
    solar(2, 14, '情人節', false),
    solar(3, 8, '婦女節', false),
    solar(3, 12, '植樹節', false),
    solar(4, 1, '愚人節', false),
    solar(4, 5, '清明節', true),
    solar(5, 1, '勞動節', true),
    solar(5, 4, '青年節', false),
    solar(6, 1, '兒童節', false),
    solar(7, 1, '建黨節', false),
    solar(8, 1, '建軍節', false),
    solar(9, 10, '教師節', false),
    solar(10, 1, '國慶節', true, { picture: true }),
    solar(12, 25, '聖誕節', true, { picture: true, music: true, giftCard: true }),
    nth(5, 2, 0, '母親節', false),
    lunarEve('除夕', true, true),
    lunar(1, 1, '春節', true, { music: true }),
    lunar(1, 2, '春節初二', true, { music: true }),
    lunar(1, 3, '春節初三', true, { music: true }),
    lunar(1, 15, '元宵節', false),
    lunar(5, 5, '端午節', true),
    lunar(7, 15, '中元節', false),
    lunar(8, 15, '中秋節', true),
  ],
  // 2: 日本 (19 entries)
  [
    solar(1, 1, '元旦', true, { picture: true }),
    solar(1, 15, '成人の日', true),
    solar(2, 11, '建国記念の日', true),
    solar(2, 14, '情人節', false),
    solar(3, 3, '雛祭り', false),
    solar(3, 21, '春分の日', true),
    solar(4, 1, '愚人節', false),
    solar(4, 29, 'みどりの日', true),
    solar(5, 3, '憲法記念日', true),
    solar(5, 5, 'こどもの日', true),
    solar(7, 7, '七夕', false),
    solar(9, 15, '敬老の日', true),
    solar(9, 23, '秋分の日', true),
    solar(10, 10, '体育の日', true),
    solar(11, 3, '文化の日', true),
    solar(11, 23, '勤労感謝の日', true),
    solar(12, 23, '天皇誕生日', true),
    solar(12, 25, '聖誕節', true, { picture: true, music: true, giftCard: true }),
    nth(5, 2, 0, '母の日', false),
  ],
  // 3: 美國 (14 entries)
  [
    solar(1, 1, "New Year's Day", true, { picture: true }),
    solar(2, 14, "Valentine's Day", false),
    solar(4, 1, "April Fools' Day", false),
    solar(7, 4, 'Independence Day', true, { picture: true }),
    solar(10, 31, 'Halloween', false),
    solar(12, 25, 'Christmas', true, { picture: true, music: true, giftCard: true }),
    nth(1, 3, 1, 'MLK Day', true),
    nth(2, 3, 1, "Presidents' Day", true),
    nth(5, 2, 0, "Mother's Day", false),
    nth(5, 4, 1, 'Memorial Day', true),
    nth(6, 3, 0, "Father's Day", false),
    nth(9, 1, 1, 'Labor Day', true),
    nth(10, 2, 1, 'Columbus Day', true),
    nth(11, 4, 4, 'Thanksgiving', true),
  ],
  // 4..7: 第二關組 (gift-card-only entries, no market rest)
  [solar(12, 25, '聖誕節', false, { giftCard: true })],
  [lunarEve('除夕', false, true)],
  [solar(12, 25, '聖誕節', false, { giftCard: true })],
  [solar(12, 25, '聖誕節', false, { giftCard: true })],
];

let chineseFormatter: Intl.DateTimeFormat | null | undefined;
function getChineseFormatter(): Intl.DateTimeFormat | null {
  if (chineseFormatter !== undefined) return chineseFormatter;
  try {
    chineseFormatter = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  } catch {
    chineseFormatter = null;
  }
  return chineseFormatter;
}

/** Lunar `[month, day]` of a Gregorian `PackedDate`, or `null` on leap months / unsupported environments. */
export function lunarDate(d: PackedDate): [number, number] | null {
  const f = getChineseFormatter();
  if (!f) return null;
  const parts = f.formatToParts(new Date(Date.UTC(yearOf(d), monthOf(d) - 1, dayOf(d))));
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  const dd = parts.find(p => p.type === 'day')?.value ?? '';
  if (!/^\d+$/.test(m) || !/^\d+$/.test(dd)) return null;
  return [Number(m), Number(dd)];
}

function matchesEntry(d: PackedDate, y: number, m: number, dd: number, entry: HolidayEntry, cachedLunar: { got: boolean; val: [number, number] | null }): boolean {
  switch (entry.kind) {
    case 'solar':
      return entry.month === m && entry.day === dd;
    case 'nthWeekday': {
      if (entry.month !== m || entry.weekday === undefined) return false;
      const w1 = weekdayOf(pack(y, m, 1));
      const first = ((entry.weekday - w1 + 7) % 7) + 1;
      const targetDay = first + (entry.day - 1) * 7;
      return dd === targetDay;
    }
    case 'lunar': {
      if (!cachedLunar.got) { cachedLunar.val = lunarDate(d); cachedLunar.got = true; }
      const l = cachedLunar.val;
      return !!l && l[0] === entry.month && l[1] === entry.day;
    }
    case 'lunarEve': {
      const tomorrow = lunarDate(addDays(d, 1));
      return !!tomorrow && tomorrow[0] === 1 && tomorrow[1] === 1;
    }
  }
}

/** Look up the first matching holiday entry on `date` for `mapSlot` (0..7), or `null`. */
export function lookupHoliday(date: PackedDate, mapSlot: number): HolidayEntry | null {
  const table = HOLIDAY_TABLES[mapSlot];
  if (!table) return null;
  const y = yearOf(date), m = monthOf(date), dd = dayOf(date);
  const cachedLunar = { got: false, val: null as [number, number] | null };
  for (const entry of table) {
    if (matchesEntry(date, y, m, dd, entry, cachedLunar)) return entry;
  }
  return null;
}

const DEFAULT_YEAR = 2026;

function resolveArgs(a: number, b: number, c?: number, d?: number): { date: PackedDate; mapSlot: number } {
  if (c === undefined) return { date: a, mapSlot: b };
  return { date: pack(d ?? DEFAULT_YEAR, a, b), mapSlot: c };
}

/** True when `date` (or `month, day`) matches any holiday entry on `mapSlot`. */
export function isHoliday(date: PackedDate, mapSlot: number): boolean;
export function isHoliday(month: number, day: number, mapSlot: number, year?: number): boolean;
export function isHoliday(a: number, b: number, c?: number, d?: number): boolean {
  const { date, mapSlot } = resolveArgs(a, b, c, d);
  return lookupHoliday(date, mapSlot) !== null;
}

/** True when `date` is a market/bank holiday (`rest === true`) on `mapSlot`. */
export function isMarketHoliday(date: PackedDate, mapSlot: number): boolean {
  return lookupHoliday(date, mapSlot)?.rest === true;
}

/** Holiday name on `date` (or `month, day`) for `mapSlot`, or `null`. */
export function holidayName(date: PackedDate, mapSlot: number): string | null;
export function holidayName(month: number, day: number, mapSlot: number, year?: number): string | null;
export function holidayName(a: number, b: number, c?: number, d?: number): string | null {
  const { date, mapSlot } = resolveArgs(a, b, c, d);
  return lookupHoliday(date, mapSlot)?.name ?? null;
}

/** True when every living player should receive 1 random card on `date` for `mapSlot`. */
export function holidayGiftCard(date: PackedDate, mapSlot: number): boolean {
  return lookupHoliday(date, mapSlot)?.giftCard === true;
}
