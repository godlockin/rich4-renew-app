/**
 * 直播市區's rules (docs/rules/25-live-city.md, the remake's addition; 自製地圖 #9, map 108, classic mode only),
 * registered in MAP_RULES like 激情歲月's (core/jiqing.ts) and 歌舞伎町's (core/kabukicho.ts).
 *
 *  - Six-island layout (直播塔島, 直播基地島, 電競島, 網紅島, 夜市島, 帶貨島) + 小黑屋 prison spur,
 *    with one-way 彈幕大橋 from 帶貨島 → 直播塔島.
 *  - 連麥 PK (event 21, §4.2): visitor and nearest living opponent each roll a die (`g.rng.rand()`);
 *    the lower roll pays the other 2,000 × priceIndex (tie = nothing).
 *  - 直播間 (fate, §6): 48-card deck = 24 normal fate + 24 streamer tasks.
 *    Computers (and humans when `streamerTasksEnabled` is off) only draw normal fate.
 *    Streamer tasks spin a 10-rule viewer-picker wheel (§6.2), then ask the human 「完成了！」(+30 點券)
 *    vs 「我不幹」(−3,000 × priceIndex).
 *  - 上熱搜 (news, §7): 24 map-specific news cards.
 *
 * Every own random choice (decks, viewer wheel, card targets) uses deterministic streams seeded from
 * `g.rollSeed()`, day, player, and a saved draw counter — never `Math.random()`.
 */
import type { BoardNode, Land } from './board';
import { ask, type Flow } from './flow';
import { MAP_RULES, type Game, type MapRules } from './game';
import { Rng, daySeed } from './rng';
import { shuffleDeck, type ResultLine } from './modules/events';
import type { Player } from './types';

export const LIVE_MAP = 108;
export const LIVE_NAME = '直播市區';
/** New square event: 連麥 PK (§4.2). */
export const EV_PK = 21;
export const LIVE_ID_BASE = 108000;
export const PK_STAKE = 2000;
export const TASK_REWARD_POINTS = 30;
export const TASK_PENALTY_CASH = 3000;

export const LIVE_FAC_NAMES: Record<number, string> = {
  0: '吃播廣場',
  1: '網紅酒店',
  2: '電競館',
  3: '帶貨倉庫',
  4: '直播基地',
};

export interface ViewerRule {
  id: number;
  text: string;
  hasN?: boolean;
}

/** 10 viewer-selection rules for streamer tasks (§6.2). */
export const LIVE_VIEWER_RULES: readonly ViewerRule[] = [
  { id: 1, text: '接下來第一個發彈幕的人' },
  { id: 2, text: '彈幕往上數第 {n} 條', hasN: true },
  { id: 3, text: '名字最長的那位觀眾' },
  { id: 4, text: '最後一個進直播間的人' },
  { id: 5, text: '下一個說「哈哈哈」的人' },
  { id: 6, text: '最近一個發「？」的人' },
  { id: 7, text: '名字裡有數字的觀眾（沒有就重轉）' },
  { id: 8, text: '粉絲牌等級最低的那位' },
  { id: 9, text: '下一個送小花的人（沒有就改規則 1）' },
  { id: 10, text: '主播自己挑一位老觀眾' },
];

export type StreamerTaskCategory = '表演' | '嘴炮' | '懲罰' | '交給觀眾' | '互動';

export interface LiveFateCard {
  id: string;
  kind: 'normal' | 'task';
  good: 0 | 1;
  head: string;
  text: string;
  category?: StreamerTaskCategory;
}

export interface LiveNewsCard {
  id: string;
  category: string;
  good: 0 | 1;
  head: string;
  text: string;
}

/** 24 streamer tasks (§6.3). */
export const LIVE_STREAMER_TASKS: readonly LiveFateCard[] = [
  { id: 'live-t-01', kind: 'task', good: 1, category: '表演', head: '點歌時間', text: '給 TA 唱一句歌' },
  { id: 'live-t-02', kind: 'task', good: 1, category: '表演', head: '萌寵模仿', text: '學三聲貓叫給 TA 聽' },
  { id: 'live-t-03', kind: 'task', good: 1, category: '表演', head: '才藝熱舞', text: '給 TA 跳 10 秒舞' },
  { id: 'live-t-04', kind: 'task', good: 1, category: '表演', head: '夾子音挑戰', text: '用夾子音念 TA 的名字三遍' },
  { id: 'live-t-05', kind: 'task', good: 1, category: '表演', head: '家鄉問候', text: '用家鄉話跟 TA 打個招呼' },
  { id: 'live-t-06', kind: 'task', good: 1, category: '表演', head: '表情管理', text: '給 TA 表演一個你最拿手的表情' },
  { id: 'live-t-07', kind: 'task', good: 1, category: '嘴炮', head: '花式誇誇', text: '誇 TA 30 秒，不能重複' },
  { id: 'live-t-08', kind: 'task', good: 1, category: '嘴炮', head: '專屬外號', text: '給 TA 起一個外號' },
  { id: 'live-t-09', kind: 'task', good: 1, category: '嘴炮', head: '彈幕朗讀', text: '念出 TA 最近的三條彈幕' },
  { id: 'live-t-10', kind: 'task', good: 1, category: '嘴炮', head: '主播新名', text: '讓 TA 給你起外號，這局都用它' },
  { id: 'live-t-11', kind: 'task', good: 1, category: '嘴炮', head: '新聞播報', text: '用播音腔播報 TA 的名字' },
  { id: 'live-t-12', kind: 'task', good: 0, category: '懲罰', head: '健身時刻', text: '為 TA 做 10 個深蹲' },
  { id: 'live-t-13', kind: 'task', good: 0, category: '懲罰', head: '語音變聲', text: '下一回合只能用夾子音說話' },
  { id: 'live-t-14', kind: 'task', good: 0, category: '懲罰', head: '語氣指定', text: '用 TA 指定的語氣說下一句話' },
  { id: 'live-t-15', kind: 'task', good: 0, category: '懲罰', head: '口頭禪', text: '下一回合說話前都要先說「家人們」' },
  { id: 'live-t-16', kind: 'task', good: 0, category: '懲罰', head: '憋笑挑戰', text: '憋笑 10 秒，彈幕來逗你' },
  { id: 'live-t-17', kind: 'task', good: 0, category: '交給觀眾', head: '岔路遙控', text: '讓 TA 決定你下一個岔路往哪走' },
  { id: 'live-t-18', kind: 'task', good: 0, category: '交給觀眾', head: '買地聽你的', text: '下一塊地 TA 說買就買、說不買就不買' },
  { id: 'live-t-19', kind: 'task', good: 0, category: '交給觀眾', head: '出牌聽你的', text: '讓 TA 決定你下一回合用不用卡片' },
  { id: 'live-t-20', kind: 'task', good: 0, category: '交給觀眾', head: '放狠話', text: '讓 TA 選一個對手，你對他說一句狠話' },
  { id: 'live-t-21', kind: 'task', good: 0, category: '交給觀眾', head: '破產口號', text: '讓 TA 給這局的你取一句口號，每次破產前都要喊' },
  { id: 'live-t-22', kind: 'task', good: 0, category: '互動', head: '猜拳對決', text: '跟 TA 猜拳，輸了再罰一次' },
  { id: 'live-t-23', kind: 'task', good: 0, category: '互動', head: '彈幕出題', text: '讓 TA 出一道題，答錯罰 3,000' },
  { id: 'live-t-24', kind: 'task', good: 1, category: '互動', head: '隔空合唱', text: '跟 TA 合唱一句（TA 打字，你唱）' },
];

/** 24 normal fate cards (§6.4). */
export const LIVE_NORMAL_FATE: readonly LiveFateCard[] = [
  { id: 'live-f-01', kind: 'normal', good: 1, head: '直播爆了！', text: '直播間熱度衝上首頁，收到打賞 {amount} 元' },
  { id: 'live-f-02', kind: 'normal', good: 1, head: '漲粉十萬', text: '短片爆紅漲粉十萬，獲得 {points} 點券' },
  { id: 'live-f-03', kind: 'normal', good: 1, head: '連麥大佬', text: '跟大主播連麥互動，得到一張卡片' },
  { id: 'live-f-04', kind: 'normal', good: 1, head: '品牌贊助', text: '接到電商推廣合作，獲得贊助費 {amount} 元' },
  { id: 'live-f-05', kind: 'normal', good: 1, head: '平台推薦位', text: '獲得首頁推薦位，流量暴漲 +{points} 點券' },
  { id: 'live-f-06', kind: 'normal', good: 1, head: '剪輯出圈', text: '二創切片全網轉發，分紅 {amount} 元' },
  { id: 'live-f-07', kind: 'normal', good: 1, head: '粉絲見面會', text: '線下見面會門票售罄，淨賺 {amount} 元' },
  { id: 'live-f-08', kind: 'normal', good: 1, head: '設備升級', text: '廠商免費贈送頂級聲卡，省下一筆 +{points} 點券' },
  { id: 'live-f-09', kind: 'normal', good: 1, head: '帶貨大賣', text: '專場直播一秒售罄，佣金入帳 {amount} 元' },
  { id: 'live-f-10', kind: 'normal', good: 1, head: '年度優秀主播', text: '獲選年度優秀主播，獎金 {amount} 元' },
  { id: 'live-f-11', kind: 'normal', good: 1, head: '好運連連', text: '直播抽獎手氣極佳，獲得一張卡片' },
  { id: 'live-f-12', kind: 'normal', good: 1, head: '旅遊 Vlog', text: '受邀出國旅遊直播 3 天，沿途免付過路費' },
  { id: 'live-f-13', kind: 'normal', good: 0, head: '平台限流', text: '標題違規被平台限流，原地停一回合' },
  { id: 'live-f-14', kind: 'normal', good: 0, head: '帶貨翻車', text: '選品出問題被退貨，賠償 {amount} 元' },
  { id: 'live-f-15', kind: 'normal', good: 0, head: '熬夜直播倒下', text: '連續通宵開播體力不支，住院 3 天' },
  { id: 'live-f-16', kind: 'normal', good: 0, head: '被舉報違規', text: '直播間被誤判舉報，小黑屋反省 2 天' },
  { id: 'live-f-17', kind: 'normal', good: 0, head: '版權警告', text: '背景音樂版權警告，繳納授權費 {amount} 元' },
  { id: 'live-f-18', kind: 'normal', good: 0, head: '設備故障', text: '開播一半麥克風燒壞，維修費 {amount} 元' },
  { id: 'live-f-19', kind: 'normal', good: 0, head: '掉粉危機', text: '口誤引發爭議掉粉，損失 {points} 點券' },
  { id: 'live-f-20', kind: 'normal', good: 0, head: '網線被挖斷', text: '施工隊挖斷光纖，斷網停一回合' },
  { id: 'live-f-21', kind: 'normal', good: 0, head: '黑粉衝塔', text: '遭遇惡意節奏，買水軍澄清花費 {amount} 元' },
  { id: 'live-f-22', kind: 'normal', good: 0, head: '聲帶拉傷', text: '喊麥太用力聲帶發炎，住院休養 2 天' },
  { id: 'live-f-23', kind: 'normal', good: 0, head: '稅務補繳', text: '工作室年度結算，補繳稅款 {amount} 元' },
  { id: 'live-f-24', kind: 'normal', good: 0, head: '帳號異常', text: '異地登入觸發風控，小黑屋驗證 1 天' },
];

export const LIVE_FATE: readonly LiveFateCard[] = [...LIVE_NORMAL_FATE, ...LIVE_STREAMER_TASKS];

/** 24 map-specific news cards (§7). */
export const LIVE_NEWS: readonly LiveNewsCard[] = [
  { id: 'live-n-01', category: '熱搜第一', good: 1, head: '#全城奶茶第二杯半價#', text: '網紅打卡街人潮爆滿，網紅街地主各得 {amount} 元' },
  { id: 'live-n-02', category: '熱搜爆點', good: 0, head: '#某主播翻車#', text: '帶貨話題發酵，飛速快遞股價跌停 2 天' },
  { id: 'live-n-03', category: '電競頭條', good: 1, head: '#電競決賽#', text: '全城電競熱潮！電競館 3 天收費 ×2' },
  { id: 'live-n-04', category: '突發快訊', good: 0, head: '#全網斷網1小時#', text: '骨幹網波動，所有在場玩家停一回合' },
  { id: 'live-n-05', category: '平台公告', good: 1, head: '#流量扶持計畫#', text: '全城創作者激勵，所有人獲得 {points} 點券' },
  { id: 'live-n-06', category: '行業風向', good: 1, head: '#MCN上市傳聞#', text: '資本看好直播產業，家人們MCN 股價漲停 2 天' },
  { id: 'live-n-07', category: '美食熱搜', good: 1, head: '#夜市吃播節#', text: '夜市吃播街人氣飆升，地主各得 {amount} 元' },
  { id: 'live-n-08', category: '消費提醒', good: 0, head: '#理性消費倡議#', text: '直播間打賞冷靜期，3 天內過路費減半' },
  { id: 'live-n-09', category: '科技熱搜', good: 1, head: '#新款旗艦直播手機#', text: '大屏手機發售大賣，股價漲停 2 天' },
  { id: 'live-n-10', category: '文娛快訊', good: 1, head: '#全城才藝大賽#', text: '人人都能上熱搜，所有玩家各得一張卡片' },
  { id: 'live-n-11', category: '平台治理', good: 0, head: '#清朗行動開始#', text: '嚴查違規標題黨，所有玩家罰款 {amount} 元' },
  { id: 'live-n-12', category: '健康提醒', good: 0, head: '#拒絕通宵開播#', text: '關注主播健康，醫院住院中的玩家提前出院' },
  { id: 'live-n-13', category: '電商大促', good: 1, head: '#321上鏈接#', text: '雙十一預熱開啟，帶貨倉庫區地主各得 {amount} 元' },
  { id: 'live-n-14', category: '交通熱搜', good: 0, head: '#外賣騎手大罷工#', text: '閃送外賣股價跌停 2 天' },
  { id: 'live-n-15', category: '遊戲熱搜', good: 1, head: '#懷舊遊戲復興#', text: '像素遊戲成為年度黑馬，股價漲停 2 天' },
  { id: 'live-n-16', category: '商圈動態', good: 1, head: '#網紅酒店滿房#', text: '外地粉絲湧入打卡，網紅酒店 3 天收費 ×2' },
  { id: 'live-n-17', category: '平台福利', good: 1, head: '#週年慶撒紅包#', text: '平台發放開播紅包，所有人現金 +{amount} 元' },
  { id: 'live-n-18', category: '突發狀況', good: 0, head: '#伺服器機房過熱#', text: '直播基地街暫時斷線，所有人損失 {points} 點券' },
  { id: 'live-n-19', category: '物流熱搜', good: 1, head: '#極速達上線#', text: '電商物流效率翻倍，飛速快遞股價漲停 2 天' },
  { id: 'live-n-20', category: '飲品熱搜', good: 1, head: '#新品爆款奶茶#', text: '全城排隊買奶茶，甜心奶茶股價漲停 2 天' },
  { id: 'live-n-21', category: '惡搞熱搜', good: 0, head: '#表情包大戰#', text: '最富有的玩家被做成鬼畜影片，損失 {amount} 元公關費' },
  { id: 'live-n-22', category: '夜生活熱搜', good: 1, head: '#Livehouse音樂夜#', text: '現場氣氛炸裂，吃播與娛樂設施 3 天收費 ×2' },
  { id: 'live-n-23', category: '防沉迷公告', good: 0, head: '#未成年人保護#', text: '未成年角色今日不得進入娛樂場所，各獲補償 {points} 點券' },
  { id: 'live-n-24', category: '熱搜總結', good: 1, head: '#直播市區繁榮指數創新高#', text: '全城商戶共贏，所有人獲得 {amount} 元分紅' },
];

/** Sample fake danmu lines (§8.2) for UI/fx consumers. */
export const LIVE_FAKE_DANMU: Record<'bomb' | 'toll' | 'task' | 'buy' | 'pk', readonly string[]> = {
  bomb: ['哈哈哈哈哈', '主播好慘', '節目效果拉滿'],
  toll: ['破防了', '心疼錢包', '這過路費太離譜了'],
  task: ['快做！', '不做取關', '截圖留念'],
  buy: ['富哥', '地產大亨', '這條街被承包了'],
  pk: ['PK 起來！', '誰輸誰尷尬', '666666'],
};

export interface LiveState {
  /** Active news modifiers (name -> days remaining). */
  mods: Record<string, number>;
  /** Shuffled news deck & cursor. */
  news: { deck: number[]; next: number };
  /** Shuffled fate deck & cursor (48 cards: 24 normal + 24 tasks). */
  fate: { deck: number[]; next: number };
  /** Setting toggle (§6.1, default true): when false, humans only draw normal fate. */
  streamerTasksEnabled: boolean;
  /** Deterministic draw counter. */
  draws: number;
  /** Last drawn streamer task + viewer rule (for inspection/UI). */
  lastTask?: { cardId: string; viewerRuleId: number; viewerRuleText: string; n?: number };
}

export class LiveCityRules implements MapRules {
  s: LiveState;

  constructor(readonly g: Game) {
    this.s = {
      mods: {},
      news: { deck: [], next: 0 },
      fate: { deck: [], next: 0 },
      streamerTasksEnabled: true,
      draws: 0,
    };
    const r = this.stream(0x5eed, -1);
    this.s.news.deck = shuffleDeck(r, LIVE_NEWS.length);
    this.s.fate.deck = shuffleDeck(r, LIVE_FATE.length);
  }

  saveState(): LiveState { return this.s; }
  loadState(s: unknown): void {
    if (s && typeof s === 'object') this.s = { ...this.s, ...(s as LiveState) };
  }

  /** Deterministic PRNG stream seeded from game seed, day, player, and draw counter. */
  stream(salt: number, p: number): Rng {
    const g = this.g;
    this.s.draws = (this.s.draws + 1) >>> 0;
    return new Rng(daySeed((g.rollSeed() ^ salt ^ Math.imul(p + 2, 0x9e3779b1) ^ Math.imul(this.s.draws, 0x85ebca6b)) >>> 0, g.daysElapsed));
  }

  mod(name: string): boolean { return (this.s.mods[name] ?? 0) > 0; }
  facName(type: number): string { return LIVE_FAC_NAMES[type] ?? ''; }

  daily(_g: Game = this.g): void {
    for (const k of Object.keys(this.s.mods)) {
      if (--this.s.mods[k] <= 0) delete this.s.mods[k];
    }
  }

  tollFactor(_g: Game, _land: Land): number {
    return this.mod('half-toll') ? 0.5 : 1;
  }

  /** Handles custom square events: 連麥 PK (event 21). */
  *landSquare(g: Game, p: Player, n: BoardNode): Flow<boolean> {
    if (n.event !== EV_PK) return false;
    yield* this.runPk(g, p);
    return true;
  }

  /**
   * 連麥 PK (§4.2): `p` and the nearest living opponent each roll 1..6 via `g.rng.rand()`.
   * Lower roll pays the other `2000 * g.priceIndex`; tie pays nothing.
   */
  *runPk(g: Game, p: Player): Flow<void> {
    const opp = this.nearestOpponent(g, p);
    if (!opp) {
      yield { t: 'fx', kind: 'live-pk', p: p.id, data: { opponent: -1, myRoll: 0, oppRoll: 0, amount: 0 } };
      yield* g.say(p.id, '連麥 PK：附近沒有對手，平安無事');
      return;
    }
    const myRoll = (g.rng.rand() % 6) + 1;
    const oppRoll = (g.rng.rand() % 6) + 1;
    const stake = PK_STAKE * g.priceIndex;
    yield { t: 'fx', kind: 'live-pk', p: p.id, data: { opponent: opp.id, myRoll, oppRoll, amount: myRoll === oppRoll ? 0 : stake } };
    if (myRoll === oppRoll) {
      yield* g.say(p.id, `連麥 PK 平手（${myRoll}:${oppRoll}）`, `${g.name(p.id)} 與 ${g.name(opp.id)} 連麥 PK 平手`);
      return;
    }
    const loser = myRoll < oppRoll ? p : opp;
    const winner = myRoll < oppRoll ? opp : p;
    const paid = yield* g.transfer(loser.id, winner.id, stake, 0, '連麥 PK');
    yield* g.say(
      loser.id,
      `連麥 PK 輸了！付給 ${g.name(winner.id)} ${paid} 元`,
      `${g.name(p.id)}(${myRoll}) vs ${g.name(opp.id)}(${oppRoll})：${g.name(loser.id)} 付給 ${g.name(winner.id)} ${paid} 元`,
    );
  }

  /** Nearest living, placed opponent by Euclidean distance on the board. */
  nearestOpponent(g: Game, p: Player): Player | undefined {
    const pn = g.node(p.node);
    let best: Player | undefined;
    let bestDist = Infinity;
    for (const q of g.living()) {
      if (q.id === p.id || !q.placed) continue;
      const qn = g.node(q.node);
      const d = Math.hypot(qn.x - pn.x, qn.y - pn.y);
      if (d < bestDist) {
        bestDist = d;
        best = q;
      }
    }
    return best;
  }

  /** Spins the 10-rule viewer selection wheel (§6.2). */
  pickViewerRule(p: Player): { id: number; text: string; n?: number } {
    const rng = this.stream(0x71e7, p.id);
    const rule = LIVE_VIEWER_RULES[rng.below(LIVE_VIEWER_RULES.length)];
    if (rule.hasN) {
      const n = 3 + rng.below(10); // 3..12
      return { id: rule.id, text: rule.text.replace('{n}', String(n)), n };
    }
    return { id: rule.id, text: rule.text };
  }

  /** 直播間 (§6): draws from the 48-card fate deck (computers/disabled-tasks skip streamer tasks). */
  *fate(g: Game, p: Player): Flow<boolean> {
    const allowTask = g.isHuman(p) && this.s.streamerTasksEnabled;
    for (let i = 0; i < LIVE_FATE.length; i++) {
      const idx = this.s.fate.deck[this.s.fate.next];
      this.s.fate.next = (this.s.fate.next + 1) % LIVE_FATE.length;
      const c = LIVE_FATE[idx];
      if (c.kind === 'task' && !allowTask) continue;
      if (c.kind === 'task') {
        yield* this.runStreamerTask(g, p, c);
        return true;
      }
      if (yield* this.runNormalFate(g, p, c)) return true;
    }
    return true;
  }

  /** Executes a streamer task card (§6.3). */
  *runStreamerTask(g: Game, p: Player, c: LiveFateCard): Flow<void> {
    const viewer = this.pickViewerRule(p);
    this.s.lastTask = { cardId: c.id, viewerRuleId: viewer.id, viewerRuleText: viewer.text, n: viewer.n };
    const penalty = TASK_PENALTY_CASH * g.priceIndex;
    yield {
      t: 'fx',
      kind: 'live-streamer-task',
      p: p.id,
      data: {
        id: LIVE_ID_BASE + LIVE_FATE.indexOf(c),
        cardId: c.id,
        category: c.category,
        head: c.head,
        text: c.text,
        viewerRule: viewer,
        rewardPoints: TASK_REWARD_POINTS,
        penaltyCash: penalty,
      },
    };
    const done = (yield ask({
      t: 'yesno',
      p: p.id,
      kind: 'live-task',
      text: `【主播任務・${c.category}】${c.head}\n\n抽取觀眾：${viewer.text}\n任務內容：${c.text}\n\n完成 +${TASK_REWARD_POINTS} 點券 / 不幹罰 ${penalty} 元`,
      price: penalty,
    })) as boolean;

    if (done) {
      p.points = Math.min(0xffff, p.points + TASK_REWARD_POINTS);
      yield { t: 'points', p: p.id, amount: TASK_REWARD_POINTS };
      yield* g.say(p.id, `主播任務完成！+${TASK_REWARD_POINTS} 點券`);
    } else {
      const paid = yield* g.transfer(p.id, -1, penalty, 0, '主播任務未完成');
      yield* g.say(p.id, `主播選擇不幹，罰款 ${paid} 元`);
    }
  }

  /** Executes a normal fate card (§6.4). */
  *runNormalFate(g: Game, p: Player, c: LiveFateCard): Flow<boolean> {
    const F = g.priceIndex;
    const show = (text: string) => ({ t: 'fx' as const, kind: 'fate' as const, p: p.id, data: { id: LIVE_ID_BASE + LIVE_FATE.indexOf(c), text, city: LIVE_NAME } });
    const res = (fx: string, lines: ResultLine[]) => ({
      t: 'fx' as const, kind: 'event-result' as const, p: p.id,
      data: { src: 'fate', id: LIVE_ID_BASE + LIVE_FATE.indexOf(c), fx, title: '直播間', head: c.head, lines, tag: LIVE_NAME, focus: [p.id] },
    });
    const cashGain = function* (amount: number): Flow<boolean> {
      yield show(c.text.replace('{amount}', String(amount)));
      g.gain(p, amount, 0);
      yield res('gain', [{ p: p.id, text: c.head, amount }]);
      return true;
    };
    const cashFine = function* (amount: number): Flow<boolean> {
      yield show(c.text.replace('{amount}', String(amount)));
      const paid = yield* g.transfer(p.id, -1, amount, 0, c.head);
      yield res('fine', [{ p: p.id, text: c.head, amount: -paid }]);
      return true;
    };
    const ptsGain = function* (pts: number): Flow<boolean> {
      yield show(c.text.replace('{points}', String(pts)));
      p.points = Math.min(0xffff, p.points + pts);
      yield { t: 'points', p: p.id, amount: pts };
      yield res('gain', [{ p: p.id, text: `點券 +${pts}` }]);
      return true;
    };

    switch (c.id) {
      case 'live-f-01': return yield* cashGain(10000 * F);
      case 'live-f-02': return yield* ptsGain(50);
      case 'live-f-03':
      case 'live-f-11': {
        yield show(c.text);
        const cardId = yield* g.cards.receiveRandom(p);
        if (cardId) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card: cardId } };
        yield res('gain', [{ p: p.id, text: cardId ? '得到一張卡片' : '卡片已發完' }]);
        return true;
      }
      case 'live-f-04': return yield* cashGain(5000 * F);
      case 'live-f-05': return yield* ptsGain(30);
      case 'live-f-06': return yield* cashGain(4000 * F);
      case 'live-f-07': return yield* cashGain(6000 * F);
      case 'live-f-08': return yield* ptsGain(20);
      case 'live-f-09': return yield* cashGain(8000 * F);
      case 'live-f-10': return yield* cashGain(12000 * F);
      case 'live-f-12': {
        yield show(c.text);
        yield* g.vanish(p, 3, false);
        yield res('abroad', [{ p: p.id, text: '出國旅遊直播 3 天' }]);
        return true;
      }
      case 'live-f-13':
      case 'live-f-20': {
        yield show(c.text);
        p.stay = Math.max(p.stay, 1);
        yield res('jam', [{ p: p.id, text: '停一回合' }]);
        return true;
      }
      case 'live-f-14': return yield* cashFine(5000 * F);
      case 'live-f-15': {
        yield show(c.text);
        yield* g.sendTo(p, 'hospital', 3);
        yield res('hospital', [{ p: p.id, text: '住院 3 天' }]);
        return true;
      }
      case 'live-f-16': {
        yield show(c.text);
        yield* g.sendTo(p, 'prison', 2);
        yield res('prison', [{ p: p.id, text: '小黑屋 2 天' }]);
        return true;
      }
      case 'live-f-17': return yield* cashFine(3000 * F);
      case 'live-f-18': return yield* cashFine(2000 * F);
      case 'live-f-19': {
        const lost = Math.min(30, p.points);
        yield show(c.text.replace('{points}', String(lost)));
        p.points -= lost;
        yield res('fine', [{ p: p.id, text: `點券 −${lost}` }]);
        return true;
      }
      case 'live-f-21': return yield* cashFine(4000 * F);
      case 'live-f-22': {
        yield show(c.text);
        yield* g.sendTo(p, 'hospital', 2);
        yield res('hospital', [{ p: p.id, text: '住院 2 天' }]);
        return true;
      }
      case 'live-f-23': return yield* cashFine(6000 * F);
      case 'live-f-24': {
        yield show(c.text);
        yield* g.sendTo(p, 'prison', 1);
        yield res('prison', [{ p: p.id, text: '小黑屋 1 天' }]);
        return true;
      }
      default: return false;
    }
  }

  /** 上熱搜 (§7): draws from the 24-card map news deck. */
  *news(g: Game, p: Player): Flow<boolean> {
    for (let i = 0; i < LIVE_NEWS.length; i++) {
      const idx = this.s.news.deck[this.s.news.next];
      this.s.news.next = (this.s.news.next + 1) % LIVE_NEWS.length;
      const c = LIVE_NEWS[idx];
      if (yield* this.runNews(g, p, c)) return true;
    }
    return true;
  }

  *runNews(g: Game, p: Player, c: LiveNewsCard): Flow<boolean> {
    const F = g.priceIndex;
    const all = g.living();
    const setMod = (k: string, d: number) => { this.s.mods[k] = Math.max(this.s.mods[k] ?? 0, d); };
    const show = (text: string) => ({
      t: 'fx' as const, kind: 'news' as const, p: p.id,
      data: { id: LIVE_ID_BASE + 100 + LIVE_NEWS.indexOf(c), category: c.category, text, city: LIVE_NAME },
    });
    const res = (fx: string, lines: ResultLine[]) => ({
      t: 'fx' as const, kind: 'event-result' as const, p: p.id,
      data: { src: 'news', id: LIVE_ID_BASE + 100 + LIVE_NEWS.indexOf(c), fx, title: c.category, head: c.head, lines, tag: LIVE_NAME },
    });
    const streetBonus = function* (streetName: string, amount: number): Flow<boolean> {
      const lots = g.board.lands.filter(l => l.name === streetName && l.owner > 0);
      if (!lots.length) return false;
      const owners = new Set(lots.map(l => l.owner - 1));
      yield show(c.text.replace('{amount}', String(amount)));
      const lines: ResultLine[] = [];
      for (const oid of owners) {
        const q = g.players[oid];
        if (!q || !q.whoPlays) continue;
        g.gain(q, amount, 0);
        lines.push({ p: q.id, text: streetName, amount });
      }
      if (!lines.length) return false;
      yield res('gain', lines);
      return true;
    };

    switch (c.id) {
      case 'live-n-01': return yield* streetBonus('網紅打卡街', 5000 * F);
      case 'live-n-07': return yield* streetBonus('夜市吃播街', 5000 * F);
      case 'live-n-13': return yield* streetBonus('帶貨倉庫區', 5000 * F);
      case 'live-n-02': {
        yield show(c.text);
        g.stocks.forceLimit(3, false, 2);
        yield res('stock-down', [{ text: '飛速快遞跌停 2 天' }]);
        return true;
      }
      case 'live-n-03': {
        yield show(c.text);
        setMod('esports-2x', 3);
        yield res('bonus', [{ text: '電競館 3 天收費 ×2' }]);
        return true;
      }
      case 'live-n-04': {
        const who = g.locals().filter(q => !g.offRoad(q));
        if (!who.length) return false;
        yield show(c.text);
        for (const q of who) q.stay = Math.max(q.stay, 1);
        yield res('jam', who.map(q => ({ p: q.id, text: '斷網停一回合' })));
        return true;
      }
      case 'live-n-05': {
        yield show(c.text.replace('{points}', '20'));
        for (const q of all) { q.points = Math.min(0xffff, q.points + 20); yield { t: 'points', p: q.id, amount: 20 }; }
        yield res('gain', all.map(q => ({ p: q.id, text: '點券 +20' })));
        return true;
      }
      case 'live-n-06': { yield show(c.text); g.stocks.forceLimit(0, true, 2); yield res('stock-up', [{ text: '家人們MCN 漲停 2 天' }]); return true; }
      case 'live-n-08': { yield show(c.text); setMod('half-toll', 3); yield res('none', [{ text: '3 天過路費減半' }]); return true; }
      case 'live-n-09': { yield show(c.text); g.stocks.forceLimit(5, true, 2); yield res('stock-up', [{ text: '大屏手機漲停 2 天' }]); return true; }
      case 'live-n-10': {
        yield show(c.text);
        const lines: ResultLine[] = [];
        for (const q of all) {
          const id = yield* g.cards.receiveRandom(q);
          if (id) { yield { t: 'fx', kind: 'card-received', p: q.id, data: { card: id } }; lines.push({ p: q.id, text: '得到一張卡片' }); }
        }
        yield res('gain', lines.length ? lines : [{ text: '卡片已發完' }]);
        return true;
      }
      case 'live-n-11': {
        const a = 1500 * F;
        yield show(c.text.replace('{amount}', String(a)));
        const lines: ResultLine[] = [];
        for (const q of all) {
          const paid = yield* g.transfer(q.id, -1, a, 0, c.head, true);
          lines.push({ p: q.id, text: c.head, amount: -paid });
        }
        yield res('tax', lines);
        return true;
      }
      case 'live-n-12': {
        const who = g.players.filter(q => q.hospital && g.here(q));
        if (!who.length) return false;
        for (const q of who) q.hospital = 0x80;
        yield show(c.text);
        yield res('release', who.map(q => ({ p: q.id, text: '提前出院' })));
        return true;
      }
      case 'live-n-14': { yield show(c.text); g.stocks.forceLimit(1, false, 2); yield res('stock-down', [{ text: '閃送外賣跌停 2 天' }]); return true; }
      case 'live-n-15': { yield show(c.text); g.stocks.forceLimit(4, true, 2); yield res('stock-up', [{ text: '像素遊戲漲停 2 天' }]); return true; }
      case 'live-n-16': { yield show(c.text); setMod('hotel-2x', 3); yield res('bonus', [{ text: '網紅酒店 3 天收費 ×2' }]); return true; }
      case 'live-n-17': {
        const a = 2000 * F;
        yield show(c.text.replace('{amount}', String(a)));
        for (const q of all) g.gain(q, a, 0);
        yield res('gain', all.map(q => ({ p: q.id, text: '開播紅包', amount: a })));
        return true;
      }
      case 'live-n-18': {
        yield show(c.text.replace('{points}', '15'));
        const lines: ResultLine[] = [];
        for (const q of all) {
          const cut = Math.min(15, q.points);
          q.points -= cut;
          lines.push({ p: q.id, text: cut ? `點券 −${cut}` : '無點券可扣' });
        }
        yield res('fine', lines);
        return true;
      }
      case 'live-n-19': { yield show(c.text); g.stocks.forceLimit(3, true, 2); yield res('stock-up', [{ text: '飛速快遞漲停 2 天' }]); return true; }
      case 'live-n-20': { yield show(c.text); g.stocks.forceLimit(2, true, 2); yield res('stock-up', [{ text: '甜心奶茶漲停 2 天' }]); return true; }
      case 'live-n-21': {
        const richest = [...all].sort((a, b) => g.wealth(b) - g.wealth(a))[0];
        if (!richest) return false;
        const a = 3000 * F;
        yield show(c.text.replace('{amount}', String(a)));
        const paid = yield* g.transfer(richest.id, -1, a, 0, '公關費');
        yield res('fine', [{ p: richest.id, text: '公關費', amount: -paid }]);
        return true;
      }
      case 'live-n-22': { yield show(c.text); setMod('livehouse-2x', 3); yield res('bonus', [{ text: 'Livehouse 3 天收費 ×2' }]); return true; }
      case 'live-n-23': {
        yield show(c.text.replace('{points}', '10'));
        for (const q of all) { q.points = Math.min(0xffff, q.points + 10); yield { t: 'points', p: q.id, amount: 10 }; }
        yield res('gain', all.map(q => ({ p: q.id, text: '點券 +10' })));
        return true;
      }
      case 'live-n-24': {
        const a = 3000 * F;
        yield show(c.text.replace('{amount}', String(a)));
        for (const q of all) g.gain(q, a, 0);
        yield res('gain', all.map(q => ({ p: q.id, text: '繁榮分紅', amount: a })));
        return true;
      }
      default: return false;
    }
  }
}

export const liveRules = (g: Game | null | undefined): LiveCityRules | undefined =>
  g?.rules instanceof LiveCityRules ? g.rules : undefined;

MAP_RULES[LIVE_MAP] = g => new LiveCityRules(g);
