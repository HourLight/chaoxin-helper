/**
 * 通知服務 (PostgreSQL 版本)
 * 
 * 更新日期：2026-01-28
 * 更新內容：訊息文字改為「確認效期」，考慮可能是登記錯誤
 */

module.exports = function(db) {
    const lineBot = require('./line-bot')(db);

    /**
     * 取得通知設定
     */
    async function getNotificationSettings() {
        try {
            const result = await db.query(`
                SELECT key, value FROM settings 
                WHERE key IN ('notification_enabled', 'notification_hours_before')
            `);
            
            const settings = {};
            result.rows.forEach(row => {
                settings[row.key] = row.value;
            });
            
            return {
                notification_enabled: settings.notification_enabled || 'true',
                notification_hours_before: settings.notification_hours_before || '24'
            };
        } catch (error) {
            console.error('取得通知設定失敗:', error);
            return {
                notification_enabled: 'true',
                notification_hours_before: '24'
            };
        }
    }

    /**
     * 取得即將到期的商品（包含已過期）
     */
    async function getExpiringItems(hours = 24) {
        try {
            const result = await db.query(`
                SELECT 
                    i.id,
                    i.quantity,
                    i.expiry_date,
                    i.created_at,
                    p.barcode,
                    p.name,
                    p.category,
                    p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = 'in_stock'
                AND i.expiry_date <= NOW() + INTERVAL '${hours} hours'
                ORDER BY i.expiry_date ASC
            `);
            return result.rows;
        } catch (error) {
            console.error('查詢即將到期商品失敗:', error);
            return [];
        }
    }

    /**
     * 取得明天到期的商品
     */
    async function getTomorrowExpiringItems() {
        try {
            const result = await db.query(`
                SELECT 
                    i.id,
                    i.quantity,
                    i.expiry_date,
                    i.created_at,
                    p.barcode,
                    p.name,
                    p.category,
                    p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = 'in_stock'
                AND DATE(i.expiry_date AT TIME ZONE 'Asia/Taipei') = 
                    DATE(NOW() AT TIME ZONE 'Asia/Taipei' + INTERVAL '1 day')
                ORDER BY i.expiry_date ASC
            `);
            return result.rows;
        } catch (error) {
            console.error('查詢明天到期商品失敗:', error);
            return [];
        }
    }

    /**
     * 取得已過期但未處理的商品
     */
    async function getExpiredItems() {
        try {
            const result = await db.query(`
                SELECT 
                    i.id,
                    i.quantity,
                    i.expiry_date,
                    p.barcode,
                    p.name,
                    p.category,
                    p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = 'in_stock'
                AND i.expiry_date <= NOW()
                ORDER BY i.expiry_date ASC
            `);
            return result.rows;
        } catch (error) {
            console.error('查詢已過期商品失敗:', error);
            return [];
        }
    }

    /**
     * 發送效期確認提醒（主要功能）
     * 訊息強調「確認效期」而非直接說「下架」
     */
    async function sendExpiryNotifications(baseUrl = null) {
        const settings = await getNotificationSettings();
        
        // 檢查是否啟用通知
        if (settings.notification_enabled !== 'true') {
            console.log('通知功能已停用');
            return { success: false, message: '通知功能已停用' };
        }

        const hours = parseInt(settings.notification_hours_before) || 24;
        const items = await getExpiringItems(hours);

        if (items.length === 0) {
            console.log('沒有需要確認效期的商品');
            return { success: true, message: '沒有需要確認效期的商品', count: 0 };
        }

        console.log(`找到 ${items.length} 個需要確認效期的商品`);

        const client = await lineBot.getClient();
        const lineSettings = await lineBot.getLineSettings();
        
        let groupId = process.env.LINE_GROUP_ID;
        if (lineSettings && lineSettings.group_id) {
            groupId = lineSettings.group_id;
        }

        if (!client || !groupId) {
            console.error('LINE Bot 未設定或找不到群組 ID');
            return { success: false, error: 'LINE Bot 未設定' };
        }

        try {
            // 分類商品
            const now = new Date();
            const expiredItems = [];
            const todayItems = [];
            const upcomingItems = [];

            items.forEach(item => {
                const expiry = new Date(item.expiry_date);
                const diffMs = expiry - now;
                const diffHours = diffMs / (1000 * 60 * 60);
                
                if (diffHours < 0) {
                    expiredItems.push(item);
                } else if (diffHours < 24) {
                    todayItems.push(item);
                } else {
                    upcomingItems.push(item);
                }
            });

            // 建立訊息
            let message = `📋 效期確認提醒\n`;
            message += `━━━━━━━━━━━━━━━\n\n`;
            
            message += `📌 請確認以下商品效期：\n`;
            message += `（可能已到期，或是登記時輸入錯誤）\n\n`;

            if (expiredItems.length > 0) {
                message += `🔴 已過期（${expiredItems.length}件）：\n`;
                expiredItems.slice(0, 5).forEach(item => {
                    const expiry = new Date(item.expiry_date);
                    message += `  • ${item.name}（${item.quantity}個）\n`;
                    message += `    效期：${expiry.toLocaleDateString('zh-TW')}\n`;
                });
                if (expiredItems.length > 5) {
                    message += `  ...還有 ${expiredItems.length - 5} 件\n`;
                }
                message += `\n`;
            }

            if (todayItems.length > 0) {
                message += `🟠 今天到期（${todayItems.length}件）：\n`;
                todayItems.slice(0, 5).forEach(item => {
                    message += `  • ${item.name}（${item.quantity}個）\n`;
                });
                if (todayItems.length > 5) {
                    message += `  ...還有 ${todayItems.length - 5} 件\n`;
                }
                message += `\n`;
            }

            if (upcomingItems.length > 0) {
                message += `🟡 即將到期（${upcomingItems.length}件）：\n`;
                upcomingItems.slice(0, 3).forEach(item => {
                    const expiry = new Date(item.expiry_date);
                    message += `  • ${item.name}（${expiry.toLocaleDateString('zh-TW')}）\n`;
                });
                if (upcomingItems.length > 3) {
                    message += `  ...還有 ${upcomingItems.length - 3} 件\n`;
                }
                message += `\n`;
            }

            message += `━━━━━━━━━━━━━━━\n`;
            message += `✅ 確認後請到系統標記處理\n`;
            message += `📝 如果是登記錯誤，請修正效期`;

            await client.pushMessage({
                to: groupId,
                messages: [{ type: 'text', text: message }]
            });

            // 記錄通知
            try {
                for (const item of items.slice(0, 10)) {
                    await db.query(`
                        INSERT INTO notification_logs (inventory_id, message, status)
                        VALUES ($1, $2, 'sent')
                    `, [item.id, `效期確認提醒：${item.name}`]);
                }
            } catch (logError) {
                console.log('記錄通知失敗（非致命）:', logError.message);
            }

            return {
                success: true,
                count: items.length,
                message: `已發送 ${items.length} 個商品的效期確認提醒`,
                summary: {
                    expired: expiredItems.length,
                    today: todayItems.length,
                    upcoming: upcomingItems.length
                }
            };
        } catch (error) {
            console.error('發送效期提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 發送明天到期商品預告（俏皮版）
     */
    async function sendTomorrowExpiryNotifications(baseUrl = null) {
        const settings = await getNotificationSettings();
        
        if (settings.notification_enabled !== 'true') {
            return { success: false, message: '通知功能已停用' };
        }

        const items = await getTomorrowExpiringItems();
        const client = await lineBot.getClient();
        const lineSettings = await lineBot.getLineSettings();
        
        let groupId = process.env.LINE_GROUP_ID;
        if (lineSettings && lineSettings.group_id) {
            groupId = lineSettings.group_id;
        }

        if (!client || !groupId) {
            return { success: false, error: 'LINE Bot 未設定' };
        }

        let message;
        if (items.length === 0) {
            message = `✨ 明天沒有商品要到期喔～\n\n但還是去巡一下貨架比較安心啦！😊`;
        } else {
            const itemList = items.slice(0, 10).map((item, i) => 
                `  ${i+1}. ${item.name}（${item.quantity}個）`
            ).join('\n');
            
            message = `💡 明天有 ${items.length} 個商品效期到期：\n\n${itemList}\n\n先記下來，明天記得確認一下喔～ 📝\n\n（如果發現效期有誤，可以先去系統修正！）`;
        }

        try {
            await client.pushMessage({
                to: groupId,
                messages: [{ type: 'text', text: message }]
            });
            
            return { success: true, count: items.length };
        } catch (error) {
            console.error('發送明天到期提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 發送已過期商品提醒
     */
    async function sendExpiredNotifications(baseUrl = null) {
        const items = await getExpiredItems();

        if (items.length === 0) {
            return { success: true, message: '沒有已過期的商品', count: 0 };
        }

        const client = await lineBot.getClient();
        const settings = await lineBot.getLineSettings();

        if (!client || !settings || !settings.group_id) {
            return { success: false, error: 'LINE Bot 未設定' };
        }

        try {
            const itemList = items.slice(0, 5).map(i => `• ${i.name}`).join('\n');
            
            const message = `📋 效期確認提醒\n\n系統顯示有 ${items.length} 個商品效期已過：\n\n${itemList}\n\n請確認：\n✅ 如果確實過期 → 標記處理\n📝 如果是登記錯誤 → 修正效期`;
            
            await client.pushMessage({
                to: settings.group_id,
                messages: [{ type: 'text', text: message }]
            });
            
            return { success: true, count: items.length };
        } catch (error) {
            console.error('發送已過期提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    return { 
        getNotificationSettings, 
        getExpiringItems, 
        getTomorrowExpiringItems, 
        getExpiredItems, 
        sendExpiryNotifications, 
        sendTomorrowExpiryNotifications, 
        sendExpiredNotifications 
    };
};
