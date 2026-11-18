# 大富翁4 重制版 App（rich4-renew-app）

大富翁4是我童年最喜欢的游戏，现在闲着没事的时候，我还是喜欢拿出来玩上一会。一玩就很容易沉浸进去。
4代的成功，让我对接下来推出的5代大感失望。
本来他可以把4代美化一下，游戏机能更新一下，就可以算得上是一个很棒的游戏了。
但他却偏偏选择发售他们认为很好玩的新的游戏机制。

既然他们不懂得做游戏，那么就由我来做吧。
高解析度重制版的 App 源码：Vite + TypeScript 遊戲本體，Capacitor 打包成 iOS App。
規則依原版反組譯還原（見 `docs/rules/`），另有新玩法「大富豪模式」（東京／大阪／札幌／九州／沖繩 12 人全國戰）。

同时也增加了新地图新玩法——歌舞伎町。在夜生活的世界里，有一套独立的事件系统与建筑风格。
更多的玩法，等我想到了就慢慢的更新。

完整素材（原版提取、高清重繪、地圖、地表、音效）不放進 Git，放在 Releases 的 `rich4-assets.tar`；地圖製作與生圖工具不在這裡。

## 游戏截图

| | |
|:---:|:---:|
| <img src="screenshots/01-title.jpg" width="420" alt="标题画面"><br>标题画面 | <img src="screenshots/02-classic-taiwan.jpg" width="420" alt="原版台湾地图"><br>原版台湾地图 |
| <img src="screenshots/03-tokyo.jpg" width="420" alt="东京"><br>东京（大富豪模式五城之一） | <img src="screenshots/04-kabukicho.jpg" width="420" alt="歌舞伎町"><br>新地图：歌舞伎町 |
| <img src="screenshots/05-jiqing-tiananmen.jpg" width="420" alt="激情岁月"><br>新地图：激情岁月 | <img src="screenshots/06-lottery.jpg" width="420" alt="乐透彩券行"><br>乐透彩券行 |
| <img src="screenshots/07-missile-film.jpg" width="420" alt="飞弹动画"><br>道具和高级卡片的电影动画 | <img src="screenshots/08-party-taunt.jpg" width="200" alt="派对模式"><br>派对模式：联机对战与嘲讽 |

下载：[最新版安装包](https://github.com/iam567/rich4-renew-app/releases/latest)（安卓 APK、iPhone IPA、Windows、Mac）

## 目錄
- `game/src/core` 規則引擎（回合、地產、股票、卡片、道具、事件、大富豪模式、獨立金融模組）
- `game/src/ui` 畫面與動畫（含 DLC 分包管理、備份匯出與更新驗簽）
- `game/ios` iOS 工程、`game/android` 安卓工程（Capacitor 7）
- `game/scripts` 素材連結、分包打包（`bundle-assets.mjs`）、安裝到 iPhone
- `tools/party-relay` 派對模式 WebSocket Relay 服務端（房間中繼、公開大廳 `/rooms`、異常上報）
- `editor/` 開源地圖可視化編輯器（`editor/site/index.html`）與路網審計腳本（`editor/audit.mjs`）
- `docs/rules` 規則文件

## 新增玩法與功能
- **每週殘局挑戰**：主畫面左上角「每週殘局」，固定種子與限定天數目標，支援防篡改回執與週榜。
- **可選對戰規則**：新遊戲與派對房間支援開啟 **24 節假日**（休市／贈卡）、**角色天賦**（12 名角色各自被動）與 **2v2 同盟**（4 人局）。
- **直播市區（Map 108）**：6 島直播主題地圖，含直播 PK 與主播任務事件，於「新遊戲 → 自製地圖」選取。
- **自由交易**：對局回合內點擊工具列「交易」，可與對手自由交換現金、地產、卡片與股票。
- **地圖分享碼與自訂素材包（BYOA）**：「新遊戲 → 匯入分享碼」可直接遊玩編輯器 2.0 匯出的 `RICH4MAP1:` 地圖；「設定 → 自訂素材包」可匯入本地 `.tar` 素材。
- **單人作弊模式**：僅限單人模式（工具列「作弊」或「系統 → 作弊模式」），可調整場上所有角色的金錢、點券、道具、卡片、神仙、地產歸屬／等級、傳送位置與物價指數。

## 進階工具與分包
```bash
# 1. 啟動地圖可視化編輯器（在倉庫根目錄執行）
python3 -m http.server 8080 -d editor/site
# 審計匯出的地圖 JSON
node editor/audit.mjs path/to/map.json

# 2. 啟動派對聯機 Relay 服務端（預設 8787 埠，詳見 tools/party-relay/README.md）
node tools/party-relay/relay.mjs

# 3. 依 DLC 分包打包素材（base / kabukicho / daimillionaire / all）
node game/scripts/bundle-assets.mjs --pack=all
```

## 執行
```bash
cd game
npm install
# 素材：下載 Releases 裡的 rich4-assets.tar（和 .sha256），檢查後解壓到 game/public
gh release download assets -p 'rich4-assets.tar*'
shasum -a 256 -c rich4-assets.tar.sha256
mkdir -p public && tar -xf rich4-assets.tar -C public
npm run dev
npm test
npm run ios      # 打包並安裝到已連接的 iPhone
npm run package  # 出安裝包到 game/release/：安卓 APK（可直接安裝）＋ 未簽名 iOS IPA
```

## 授權
GPL-3.0-or-later（規則研究引用 mytbk/rich4，見 `THIRD_PARTY.md`）。Releases 裡的大富翁4 原遊戲資源及其重繪不在此授權範圍，僅供私人使用。
