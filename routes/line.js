/**
 * LINE Bot 設定 API 路由 (PostgreSQL 版本)
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得 LINE Bot 設定
    router.get('/settings', async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM line_settings ORDER BY id DESC LIMIT 1');
            
            if (result.rows.length > 0) {
                const settings = result.rows[0];
                res.json({
                    id: settings.id,
                    hasChannelSecret: !!settings.channel_secret,
                    hasAccessToken: !!settings.channel_access_token,
                    hasGroupId: !!settings.group_id,
                    groupId: settings.group_id ? '****' + settings.group_id.slice(-6) : null,
                    isActive: settings.is_active === 1
                });
            } else {
                res.json({
                    hasChannelSecret: false,
                    hasAccessToken: false,
                    hasGroupId: false,
                    isActive: false
                });
            }
        } catch (error) {
            console.error('取得 LINE 設定失敗:', error);
            res.status(500).json({ error: '取得設定失敗' });
        }
    });

    // 更新 LINE Bot 設定
    router.post('/settings', async (req, res) => {
        try {
            const { channel_secret, channel_access_token, group_id } = req.body;
            
            const existing = await db.query('SELECT id FROM line_settings LIMIT 1');
            
            if (existing.rows.length > 0) {
                await db.query(`
                    UPDATE line_settings 
                    SET channel_secret = $1, channel_access_token = $2, group_id = $3,
                        is_active = 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = $4
                `, [channel_secret, channel_access_token, group_id || null, existing.rows[0].id]);
            } else {
                await db.query(`
                    INSERT INTO line_settings (channel_secret, channel_access_token, group_id, is_active)
                    VALUES ($1, $2, $3, 1)
                `, [channel_secret, channel_access_token, group_id || null]);
            }

            if (channel_secret) process.env.LINE_CHANNEL_SECRET = channel_secret;
            if (channel_access_token) process.env.LINE_CHANNEL_ACCESS_TOKEN = channel_access_token;
            if (group_id) process.env.LINE_GROUP_ID = group_id;

            res.json({ success: true, message: '✅ LINE Bot 設定成功！' });
        } catch (error) {
            console.error('更新 LINE 設定失敗:', error);
            res.status(500).json({ error: '更新設定失敗' });
        }
    });

    // 測試 LINE Bot 連線
    router.post('/test', async (req, res) => {
        try {
            const line = require('@line/bot-sdk');
            const result = await db.query('SELECT * FROM line_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

            if (result.rows.length === 0 || !result.rows[0].channel_access_token) {
                return res.status(400).json({ error: '請先設定 LINE Bot' });
            }

            const client = new line.messagingApi.MessagingApiClient({
                channelAccessToken: result.rows[0].channel_access_token
            });

            const botInfo = await client.getBotInfo();
            res.json({ success: true, message: '✅ 連線成功！', botName: botInfo.displayName });
        } catch (error) {
            console.error('LINE Bot 測試失敗:', error);
            res.status(500).json({ error: '連線失敗，請檢查設定是否正確', detail: error.message });
        }
    });

    // 發送測試訊息到群組
    router.post('/test-message', async (req, res) => {
        try {
            const line = require('@line/bot-sdk');
            const result = await db.query('SELECT * FROM line_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1');

            if (result.rows.length === 0 || !result.rows[0].channel_access_token) {
                return res.status(400).json({ error: '請先設定 LINE Bot' });
            }
            if (!result.rows[0].group_id) {
                return res.status(400).json({ error: '請先設定群組 ID' });
            }

            const client = new line.messagingApi.MessagingApiClient({
                channelAccessToken: result.rows[0].channel_access_token
            });

            await client.pushMessage({
                to: result.rows[0].group_id,
                messages: [{ type: 'text', text: '🎉 潮欣小幫手測試訊息\n\n如果你收到這則訊息，表示 LINE Bot 設定成功啦！💚' }]
            });
            
            res.json({ success: true, message: '✅ 測試訊息已發送到群組！' });
        } catch (error) {
            console.error('發送測試訊息失敗:', error);
            res.status(500).json({ error: '發送失敗，請檢查群組 ID 是否正確', detail: error.message });
        }
    });

    return router;
};
