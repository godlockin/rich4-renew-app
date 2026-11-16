---
trigger: always_on
description: Project maintenance best practices, architecture notes, and token-saving guidelines for rich4-renew-app
---

# rich4-renew-app 維護規範與最佳實踐

## 1. 額度與上下文控制（省 Token）
- **單一任務開新對話**：每完成一個獨立模組或功能（如 core 重構、relay、editor）即開新對話，或使用 `/compact` 壓縮歷史，避免長對話重複帶入龐大 Input Tokens。
- **使用 `rtk` 壓縮終端輸出**：本機已安裝 `rtk`（`/opt/homebrew/bin/rtk`），執行 `git`、`vitest`、`tsc`、`ls`、`grep` 等會產生大量輸出的指令時，優先加上 `rtk` 前綴（如 `rtk git status`、`rtk vitest run ...`）以精簡輸出。
- **精準讀碼**：先用 `rg -n` 定位行號，再用 `read_file` 讀取局部範圍（`< 150` 行）；禁止整檔讀取 `game/src/core/game.ts` 等大型檔案。
- **精準驗證**：開發迭代時優先跑單檔或單測（`cd game && rtk npx vitest run src/core/<file>.test.ts` 與 `rtk npx tsc --noEmit`），全部完成後再跑完整驗證。

## 2. 專案架構與關鍵約定
- **金融與規則模組**：金融與派對公平規則抽離在 `game/src/core/modules/finance.ts`（含 `fairFinance`）。
- **地圖資料格式**：`game/src/core/board.ts` 的 `parseBoard` 解析 `raw_hex`（Big5 編碼）；`node.ref` 偏移為 `2001+`（地產）、`4001+`（設施）、`6001+`（企業）。
- **素材與 DLC 分包**：使用 `node game/scripts/bundle-assets.mjs --pack=base|kabukicho|daimillionaire|all` 生成分包與 `packs-manifest.json`。**切勿**將 `game/rich4-assets.tar` 或 `.sha256` 加入 Git。
- **派對服務端與地圖編輯器**：
  - Relay 服務端：`node tools/party-relay/relay.mjs`（零依賴 Node.js WebSocket + HTTP，含 `/rooms` 大廳）。
  - 地圖編輯器：在倉庫根目錄執行 `python3 -m http.server 8080 -d editor/site`；CLI 審計用 `node editor/audit.mjs <map.json>`。

## 3. Git 與推送規範
- 本地 `origin` 為上游倉庫（`iam567/rich4-renew-app`），推送變更時請推往使用者 Fork：`https://github.com/godlockin/rich4-renew-app.git main`。
