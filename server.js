/**
 * 潮欣小幫手 - 便利商店生鮮品效期管理系統
 * 主伺服器檔案
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const cron = require('node-cron');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化資料庫
const db = new Database(path.join(__dirname, 'database', 'chaoxin.db'));
const fs = require('fs');
const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
db.exec(schema);

// LINE Webhook - 必須放在最前面，用 raw body
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    console.log('=== 收到 LINE Webhook ===');
    
    try {
        // 解析 body
        let body;
        if (Buffer.isBuffer(req.body)) {
            body = JSON.parse(req.body.toString());
        } else if (typeof req.body === 'string') {
            body = JSON.parse(req.body);
        } else {
            body = req.body;
        }
        
        console.log('Events:', JSON.stringify(body.events, null, 2));
        
        const events = body.events || [];
        if (events.length === 0) {
            console.log('沒有事件');
            return res.status(200).send('OK');
        }

        const lineBot = require('./services/line-bot')(db);
        for (const event of events) {
            console.log('處理事件:', event.type);
            await lineBot.handleEvent(event);
        }
        
        console.log('=== Webhook 處理完成 ===');
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook 錯誤:', error);
        res.status(200).send('OK');
    }
});

// Middleware（放在 webhook 之後）
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images'))); // 吉祥物圖片

// 圖片上傳設定
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// 匯入路由
const apiRoutes = require('./routes/api')(db);
const productRoutes = require('./routes/products')(db);
const inventoryRoutes = require('./routes/inventory')(db);
const lineRoutes = require('./routes/line')(db);
const fortuneRoutes = require('./routes/fortune')(db);
const gamificationRoutes = require('./routes/gamification')(db);
const reportsRoutes = require('./routes/reports')(db);

// 使用路由
app.use('/api', apiRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/line', lineRoutes);
app.use('/api/fortune', fortuneRoutes);
app.use('/api/game', gamificationRoutes);
app.use('/api/reports', reportsRoutes);

// AI 辨識路由
const aiRecognition = require('./services/ai-recognition');
app.post('/api/recognize', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '請上傳圖片' });
        }
        
        const base64Image = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;
        
        const result = await aiRecognition.recognizeProduct(base64Image, mimeType);
        res.json(result);
    } catch (error) {
        console.error('AI 辨識錯誤:', error);
        res.status(500).json({ error: '辨識失敗，請重試' });
    }
});

// 手動觸發提醒
app.post('/api/notify/manual', async (req, res) => {
    try {
        const notificationService = require('./services/notification')(db);
        const result = await notificationService.sendExpiryNotifications();
        res.json(result);
    } catch (error) {
        console.error('發送提醒失敗:', error);
        res.status(500).json({ error: '發送提醒失敗' });
    }
});

// 頁面路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/smart-register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'smart-register.html'));
});

app.get('/traditional-register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'traditional-register.html'));
});

app.get('/quick-register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'quick-register.html'));
});

app.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'products.html'));
});

app.get('/inventory', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'inventory.html'));
});

app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'settings.html'));
});

app.get('/line-settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'line-settings.html'));
});

// === 2.0 新增頁面 ===
app.get('/fortune', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'fortune.html'));
});

app.get('/achievements', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'achievements.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html'));
});

app.get('/reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'reports.html'));
});

// 初始化籤卡資料
const fortuneService = require('./services/fortune')(db);
fortuneService.initFortuneCards();

// 定時任務 - 每天早上 9 點發送「今天」效期提醒
const cronTime = process.env.NOTIFICATION_CRON_TIME || '0 9 * * *';
cron.schedule(cronTime, async () => {
    console.log('執行定時效期提醒任務（今天到期）...');
    try {
        const notificationService = require('./services/notification')(db);
        await notificationService.sendExpiryNotifications();
        console.log('定時提醒發送完成');
    } catch (error) {
        console.error('定時提醒發送失敗:', error);
    }
});

// 定時任務 - 每天晚上 9 點發送「明天」效期提醒
cron.schedule('0 21 * * *', async () => {
    console.log('執行定時效期提醒任務（明天到期）...');
    try {
        const notificationService = require('./services/notification')(db);
        await notificationService.sendTomorrowExpiryNotifications();
        console.log('明天到期提醒發送完成');
    } catch (error) {
        console.error('明天到期提醒發送失敗:', error);
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════╗
    ║                                          ║
    ║   🎉 潮欣小幫手 已啟動！                 ║
    ║                                          ║
    ║   💚 讓效期管理變簡單！                  ║
    ║                                          ║
    ║   🌐 http://localhost:${PORT}              ║
    ║                                          ║
    ╚══════════════════════════════════════════╝
    `);
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('\n正在關閉伺服器...');
    db.close();
    process.exit(0);
});

module.exports = app;
