# Singapore 24K / 999 Gold Price Monitor

用來監察新加坡 24K / 999 即時金價。

## 功能

- Poh Heng：只提取 `24K / 999 at $xxx.xx per gram`
- Chow Tai Fook SG：嘗試提取 24K / 999 每克金價；如網站阻擋或動態載入，會顯示錯誤狀態
- 網站 Dashboard 可直接查看最新金價
- GitHub Actions 每小時自動檢查一次
- 如設定 Telegram secrets，金價有變動時會通知
- 自動保存 `data/latest.json` 和 `data/history.json`

## 手動測試

到 GitHub repo：

```text
Actions → Check Singapore 24K Gold Prices → Run workflow
```

執行後查看：

```text
data/latest.json
data/history.json
```

## 開啟網站

到 repo：

```text
Settings → Pages → Build and deployment
```

設定：

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

網站一般會是：

```text
https://opjemmytsang.github.io/sg-gold-price-monitor/
```

## 允許 GitHub Actions 寫入

到 repo：

```text
Settings → Actions → General → Workflow permissions
```

選：

```text
Read and write permissions
```

## Telegram 通知設定

到 repo：

```text
Settings → Secrets and variables → Actions → New repository secret
```

新增：

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

不設定 Telegram 也可以，網站仍會更新，只是不會發通知。
