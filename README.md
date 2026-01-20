# 🎉 潮欣小幫手

**便利商店生鮮品效期管理系統 - 讓效期管理變簡單！**

---

## ✨ 功能特色

- 📸 **AI 智慧辨識** - 拍照自動辨識條碼、商品名稱、效期
- 📷 **傳統入庫** - 條碼掃描器快速登記
- 📋 **庫存管理** - 查看所有商品、效期倒數
- 🔔 **LINE 自動提醒** - 到期前自動發送提醒到群組
- 🌡️ **溫層分類** - 冷藏/冷凍/常溫分類管理
- ⏰ **定時任務** - 每天自動檢查並發送提醒

---

## 🚀 快速開始

### 1. 環境需求

- Node.js 18 以上
- npm 或 yarn

### 2. 安裝步驟

```bash
# 下載專案後，進入專案目錄
cd chaoxin-helper

# 安裝依賴
npm install

# 複製環境變數範例檔
cp .env.example .env

# 編輯 .env 填入你的設定
nano .env
```

### 3. 環境變數設定

編輯 `.env` 檔案：

```env
# 伺服器設定
PORT=3000

# LINE Bot 設定（從 LINE Developers 取得）
LINE_CHANNEL_SECRET=你的_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=你的_channel_access_token
LINE_GROUP_ID=你的群組ID

# AI 辨識設定（選填，如果要用 AI 辨識功能）
ANTHROPIC_API_KEY=你的_anthropic_api_key

# 通知設定
NOTIFICATION_HOURS_BEFORE=24
NOTIFICATION_CRON_TIME=0 9 * * *
```

### 4. 啟動服務

```bash
# 開發模式（自動重新載入）
npm run dev

# 正式環境
npm start
```

啟動後打開瀏覽器，前往 `http://localhost:3000`

---

## 📱 LINE Bot 設定

### 步驟一：建立 LINE Bot

1. 前往 [LINE Developers](https://developers.line.biz/)
2. 登入後建立 Provider
3. 建立 Messaging API Channel
4. 複製 **Channel Secret** 和 **Channel Access Token**

### 步驟二：設定 Webhook

1. 在 Messaging API 頁面設定 Webhook URL
2. URL 格式：`https://你的網域/webhook`
3. 開啟「Use webhook」

### 步驟三：加入群組

1. 建立 LINE 群組，邀請店員
2. 掃描 Bot QR Code 加入群組
3. 取得群組 ID（需透過 Webhook 取得）

---

## 🌐 部署建議

### Railway（推薦）

1. 在 [Railway](https://railway.app/) 建立新專案
2. 連接 GitHub 或上傳程式碼
3. 設定環境變數
4. 部署完成！

### Render

1. 在 [Render](https://render.com/) 建立 Web Service
2. 設定 Build Command: `npm install`
3. 設定 Start Command: `npm start`
4. 設定環境變數

### 自架 VPS

```bash
# 使用 PM2 管理程序
npm install -g pm2
pm2 start server.js --name chaoxin-helper
pm2 save
pm2 startup
```

---

## 📁 專案結構

```
chaoxin-helper/
├── server.js           # 主伺服器
├── package.json        # 專案設定
├── .env.example        # 環境變數範例
├── database/
│   └── schema.sql      # 資料庫結構
├── routes/
│   ├── api.js          # 通用 API
│   ├── products.js     # 商品 API
│   ├── inventory.js    # 庫存 API
│   └── line.js         # LINE 設定 API
├── services/
│   ├── ai-recognition.js   # AI 辨識服務
│   ├── line-bot.js         # LINE Bot 服務
│   └── notification.js     # 通知服務
└── public/
    ├── index.html      # 首頁
    ├── css/
    │   └── style.css   # 樣式檔
    ├── js/
    │   └── app.js      # 前端 JavaScript
    └── pages/
        ├── smart-register.html      # 智慧登記
        ├── traditional-register.html # 傳統入庫
        ├── inventory.html           # 庫存管理
        ├── settings.html            # 系統設定
        └── line-settings.html       # LINE Bot 設定
```

---

## 🔧 API 文件

### 商品 API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/products | 取得所有商品 |
| GET | /api/products/barcode/:barcode | 根據條碼查詢 |
| POST | /api/products | 新增商品 |
| PUT | /api/products/:id | 更新商品 |
| DELETE | /api/products/:id | 刪除商品 |

### 庫存 API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/inventory | 取得所有庫存 |
| POST | /api/inventory | 新增庫存記錄 |
| PUT | /api/inventory/:id/status | 更新狀態 |
| DELETE | /api/inventory/:id | 刪除記錄 |

### 其他 API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/dashboard | 儀表板統計 |
| GET | /api/expiring | 即將到期商品 |
| POST | /api/notify/manual | 手動發送提醒 |
| POST | /api/recognize | AI 辨識圖片 |

---

## ❓ 常見問題

### Q: AI 辨識功能需要付費嗎？

A: 需要 Anthropic API Key，有免費額度可以試用。如果不設定，系統會進入模擬模式，可以手動輸入。

### Q: LINE Bot 沒收到提醒？

A: 請檢查：
1. Channel Secret 和 Access Token 是否正確
2. Bot 是否已加入群組
3. 群組 ID 是否正確
4. 通知功能是否啟用

### Q: 如何取得群組 ID？

A: 將 Bot 加入群組後，在群組中發送任意訊息，從 Webhook 收到的訊息中取得 `source.groupId`。

---

## 📜 版權聲明

**便利商店生鮮品效期管理系統 - 潮欣小幫手**

© 2026 王逸君 版權所有 · 保留所有權利

未經授權禁止使用、複製、修改或商業使用本系統。

如需授權或商業合作，請聯繫：

**Hour Light International Co., Ltd.**  
馥靈之鑰

---

## 💚 Made with Love

潮欣小幫手 v1.0.0

讓效期管理變簡單！🧡💚❤️
