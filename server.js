/**
 * 潮欣小幫手 - 便利商店生鮮品效期管理系統
 * 主伺服器檔案 (PostgreSQL 版本)
 * 
 * 更新日期：2026-01-28
 * 更新內容：新增效期提醒診斷 API、修復定時任務
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const cron = require('node-cron');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化資料庫
let dbReady = false;
db.initDatabase().then(() => {
    dbReady = true;
    console.log('✅ 資料庫初始化完成');
    
    // 初始化籤卡資料
    try {
        const fortuneService = require('./services/fortune')(db);
        fortuneService.initFortuneCards();
    } catch (e) {
        console.log('籤卡服務跳過:', e.message);
    }
}).catch(err => {
    console.error('❌ 資料庫初始化失敗:', err);
});

// ============================================================
// LINE Webhook - 必須放在最前面，用 raw body
// ============================================================
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
    console.log('=== 收到 LINE Webhook ===');
    
    try {
        let body;
        if (Buffer.isBuffer(req.body)) {
            body = JSON.parse(req.body.toString());
        } else if (typeof req.body === 'string') {
            body = JSON.parse(req.body);
        } else {
            body = req.body;
        }
        
        console.log('Events:', JSON.stringify(body.events, null, 2));
        
        if (body.events && body.events.length > 0) {
            const lineBot = require('./services/line-bot')(db);
            for (const event of body.events) {
                try {
                    await lineBot.handleEvent(event);
                } catch (eventError) {
                    console.error('處理事件錯誤:', eventError);
                }
            }
        }
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook 錯誤:', error);
        res.status(200).json({ error: error.message });
    }
});

// ============================================================
// Middleware（放在 webhook 之後）
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 圖片上傳設定
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ============================================================
// 匯入路由
// ============================================================
const apiRoutes = require('./routes/api')(db);
const productRoutes = require('./routes/products')(db);
const inventoryRoutes = require('./routes/inventory')(db);
const lineRoutes = require('./routes/line')(db);

// 選擇性載入路由（避免檔案不存在時崩潰）
let fortuneRoutes, gamificationRoutes, reportsRoutes, scheduleRoutes, announcementRoutes;
try { fortuneRoutes = require('./routes/fortune')(db); } catch(e) { console.log('fortune 路由跳過'); }
try { gamificationRoutes = require('./routes/gamification')(db); } catch(e) { console.log('gamification 路由跳過'); }
try { reportsRoutes = require('./routes/reports')(db); } catch(e) { console.log('reports 路由跳過'); }
try { scheduleRoutes = require('./routes/schedule')(db); } catch(e) { console.log('schedule 路由跳過'); }
try { announcementRoutes = require('./routes/announcement')(db); } catch(e) { console.log('announcement 路由跳過'); }

// 使用路由
app.use('/api', apiRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/line', lineRoutes);
if (fortuneRoutes) app.use('/api/fortune', fortuneRoutes);
if (gamificationRoutes) app.use('/api/game', gamificationRoutes);
if (reportsRoutes) app.use('/api/reports', reportsRoutes);
if (scheduleRoutes) app.use('/api/schedule', scheduleRoutes);
if (announcementRoutes) app.use('/api/announcement', announcementRoutes);

// ============================================================
// AI 辨識路由
// ============================================================
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

// ============================================================
// 🔔 效期提醒 API（診斷 + 手動觸發）
// ============================================================

// 手動觸發提醒（GET 方便瀏覽器測試）
app.get('/api/notify/manual', async (req, res) => {
    console.log('📢 手動觸發效期提醒...');
    try {
        const notificationService = require('./services/notification')(db);
        const result = await notificationService.sendExpiryNotifications();
        console.log('📢 提醒結果:', result);
        res.json(result);
    } catch (error) {
        console.error('❌ 發送提醒失敗:', error);
        res.status(500).json({ 
            error: '發送提醒失敗', 
            details: error.message,
            stack: error.stack 
        });
    }
});

// 手動觸發提醒（POST）
app.post('/api/notify/manual', async (req, res) => {
    console.log('📢 手動觸發效期提醒 (POST)...');
    try {
        const notificationService = require('./services/notification')(db);
        const result = await notificationService.sendExpiryNotifications();
        res.json(result);
    } catch (error) {
        console.error('❌ 發送提醒失敗:', error);
        res.status(500).json({ error: '發送提醒失敗', details: error.message });
    }
});

// 診斷用 - 查看所有在庫商品與效期狀態
app.get('/api/notify/check', async (req, res) => {
    console.log('🔍 檢查庫存效期狀態...');
    try {
        const result = await db.query(`
            SELECT 
                i.id,
                i.quantity,
                i.expiry_date,
                i.status,
                p.name,
                p.barcode,
                p.storage_temp
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock'
            ORDER BY i.expiry_date ASC
            LIMIT 30
        `);
        
        const now = new Date();
        const items = result.rows.map(item => {
            const expiry = new Date(item.expiry_date);
            const diffMs = expiry - now;
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            return {
                id: item.id,
                name: item.name,
                barcode: item.barcode,
                quantity: item.quantity,
                expiry_date: item.expiry_date,
                storage_temp: item.storage_temp,
                diff_days: diffDays,
                status_text: diffDays < 0 ? `已過期 ${Math.abs(diffDays)} 天` : 
                             diffDays === 0 ? '今天到期！' : 
                             diffDays === 1 ? '明天到期' :
                             `還有 ${diffDays} 天`
            };
        });
        
        const expired = items.filter(i => i.diff_days < 0);
        const today = items.filter(i => i.diff_days === 0);
        const tomorrow = items.filter(i => i.diff_days === 1);
        const upcoming = items.filter(i => i.diff_days > 1 && i.diff_days <= 3);
        
        res.json({
            server_time_utc: now.toISOString(),
            server_time_tw: now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
            summary: {
                total_in_stock: items.length,
                expired: expired.length,
                today: today.length,
                tomorrow: tomorrow.length,
                within_3_days: upcoming.length
            },
            items: items
        });
    } catch (error) {
        console.error('❌ 查詢失敗:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// 診斷用 - 檢查 LINE Bot 設定狀態
app.get('/api/notify/line-status', async (req, res) => {
    console.log('🔍 檢查 LINE Bot 設定...');
    try {
        const lineBot = require('./services/line-bot')(db);
        const settings = await lineBot.getLineSettings();
        const client = await lineBot.getClient();
        
        const notifySettings = await db.query(`
            SELECT key, value FROM settings 
            WHERE key IN ('notification_enabled', 'notification_hours_before')
        `);
        const settingsMap = {};
        notifySettings.rows.forEach(row => {
            settingsMap[row.key] = row.value;
        });
        
        res.json({
            line_bot: {
                has_settings: !!settings,
                has_group_id: !!(settings && settings.group_id),
                group_id_preview: settings?.group_id ? 
                    settings.group_id.substring(0, 15) + '...' : null,
                has_client: !!client
            },
            env_vars: {
                LINE_GROUP_ID: process.env.LINE_GROUP_ID ? '✅ 已設定' : '❌ 未設定',
                LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN ? '✅ 已設定' : '❌ 未設定',
                LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET ? '✅ 已設定' : '❌ 未設定'
            },
            notification_settings: {
                enabled: settingsMap.notification_enabled || 'true',
                hours_before: settingsMap.notification_hours_before || '24'
            }
        });
    } catch (error) {
        console.error('❌ 檢查失敗:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// 診斷用 - 測試發送一則訊息到 LINE 群組
app.get('/api/notify/test-line', async (req, res) => {
    console.log('🧪 測試 LINE 訊息發送...');
    try {
        const lineBot = require('./services/line-bot')(db);
        const client = await lineBot.getClient();
        const settings = await lineBot.getLineSettings();
        
        let groupId = process.env.LINE_GROUP_ID;
        if (settings && settings.group_id) {
            groupId = settings.group_id;
        }
        
        if (!client) {
            return res.status(400).json({ error: 'LINE Client 未初始化' });
        }
        if (!groupId) {
            return res.status(400).json({ error: '找不到 GROUP_ID' });
        }
        
        const testMessage = `🧪 測試訊息\n\n這是潮欣小幫手的測試訊息\n時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`;
        
        await client.pushMessage({
            to: groupId,
            messages: [{ type: 'text', text: testMessage }]
        });
        
        res.json({ 
            success: true, 
            message: '測試訊息已發送，請檢查 LINE 群組',
            group_id_preview: groupId.substring(0, 15) + '...'
        });
    } catch (error) {
        console.error('❌ 測試失敗:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.originalError?.response?.data || null
        });
    }
});

// ============================================================
// 頁面路由
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/smart-register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'smart-register.html')));
app.get('/traditional-register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'traditional-register.html')));
app.get('/products', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'products.html')));
app.get('/inventory', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'inventory.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'settings.html')));
app.get('/line-settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'line-settings.html')));
app.get('/fortune', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'fortune.html')));
app.get('/achievements', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'achievements.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'reports.html')));
app.get('/schedule', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'schedule.html')));
app.get('/my-schedule', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'my-schedule.html')));

// 健康檢查
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        time_tw: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        db_ready: dbReady
    });
});

// ============================================================
// 定時任務 - 效期提醒
// ============================================================

// 早上 9 點提醒（第一次，溫和）
cron.schedule('0 9 * * *', async () => {
    console.log('☀️ [09:00] 執行早上效期提醒...');
    try {
        const notificationService = require('./services/notification')(db);
        await notificationService.sendExpiryNotifications();
        console.log('☀️ 早上提醒發送完成');
    } catch (error) {
        console.error('❌ 早上提醒失敗:', error);
    }
}, { timezone: "Asia/Taipei" });

// 下午 2 點提醒（第二次，中等）
cron.schedule('0 14 * * *', async () => {
    console.log('⚠️ [14:00] 執行下午效期提醒...');
    try {
        const notificationService = require('./services/notification')(db);
        await notificationService.sendExpiryNotifications();
        console.log('⚠️ 下午提醒發送完成');
    } catch (error) {
        console.error('❌ 下午提醒失敗:', error);
    }
}, { timezone: "Asia/Taipei" });

// 晚上 9 點發送明天效期提醒
cron.schedule('0 21 * * *', async () => {
    console.log('💡 [21:00] 執行明天到期預告...');
    try {
        const notificationService = require('./services/notification')(db);
        await notificationService.sendTomorrowExpiryNotifications();
        console.log('💡 明天到期提醒發送完成');
    } catch (error) {
        console.error('❌ 明天到期提醒失敗:', error);
    }
}, { timezone: "Asia/Taipei" });

// 晚上 10 點提醒（第三次，緊急）
cron.schedule('0 22 * * *', async () => {
    console.log('🚨 [22:00] 執行晚上緊急效期提醒...');
    try {
        const notificationService = require('./services/notification')(db);
        await notificationService.sendExpiryNotifications();
        console.log('🚨 晚上緊急提醒發送完成');
    } catch (error) {
        console.error('❌ 晚上緊急提醒失敗:', error);
    }
}, { timezone: "Asia/Taipei" });

// ============================================================
// 啟動伺服器
// ============================================================
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
    ║   🐘 使用 PostgreSQL 資料庫              ║
    ║                                          ║
    ║   📅 定時提醒：09:00 / 14:00 / 22:00     ║
    ║   💡 明天預告：21:00                     ║
    ║                                          ║
    ╚══════════════════════════════════════════╝
    `);
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('\n正在關閉伺服器...');
    db.pool.end();
    process.exit(0);
});

module.exports = app;
