# 大富翁4 派對模式中繼伺服器 (`tools/party-relay`)

零第三方依賴的 Node.js 中繼伺服器，完全相容 `game/src/ui/relay-peer.ts`、`party-presence.ts` 與 `party-report.ts` 協議，並額外提供 `/rooms` 公開大廳列表接口。

## 本地開發啟動

```bash
node tools/party-relay/relay.mjs
```

在遊戲瀏覽器控制台設定本機測試中繼並重新整理頁面即可：

```js
localStorage.setItem('rich4.party.relayDev', 'ws://127.0.0.1:18443');
```

## 正式環境部署（Caddy + systemd）

1. 以 `systemd` 託管 `node /opt/rich4-relay/relay.mjs`（預設監聽 `127.0.0.1:18443`，可透過 `PORT`、`HOST`、`MONTH_CAP_GB` 環境變數調整）。
2. Caddy 反向代理設定：
   ```caddyfile
   your-domain.example {
       reverse_proxy 127.0.0.1:18443
   }
   ```
3. 將 `game/relay.json` 與 `game/src/ui/net-peer.ts` 中的 `RELAYS` 改為 `wss://your-domain.example`。
