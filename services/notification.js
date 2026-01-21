/**
 * 通知服務
 * 處理效期提醒的發送
 */

module.exports = function(db) {
    const lineBot = require('./line-bot')(db);

    /**
     * 取得通知設定
     */
    function getNotificationSettings() {
        const settings = db.prepare('SELECT key, value FROM settings').all();
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });
        return settingsObj;
    }

    /**
     * 取得即將到期的商品
     */
    function getExpiringItems(hours = 24) {
        const items = db.prepare(`
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
            AND i.expiry_date <= datetime('now', '+' || ? || ' hours')
            AND i.expiry_date > datetime('now')
            ORDER BY i.expiry_date ASC
        `).all(hours);

        return items;
    }

    /**
     * 取得明天到期的商品
     */
    function getTomorrowExpiringItems() {
        const items = db.prepare(`
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
            AND date(i.expiry_date) = date('now', '+1 day')
            ORDER BY i.expiry_date ASC
        `).all();

        return items;
    }

    /**
     * 發送效期提醒
     */
    async function sendExpiryNotifications(baseUrl = null) {
        const settings = getNotificationSettings();
        
        // 檢查是否啟用通知
        if (settings.notification_enabled !== 'true') {
            console.log('通知功能已停用');
            return { success: false, message: '通知功能已停用' };
        }

        const hours = parseInt(settings.notification_hours_before) || 24;
        const items = getExpiringItems(hours);

        if (items.length === 0) {
            console.log('沒有即將到期的商品');
            return { success: true, message: '沒有即將到期的商品', count: 0 };
        }

        console.log(`找到 ${items.length} 個即將到期的商品`);

        // 發送 LINE 提醒
        const result = await lineBot.sendExpiryAlert(items, baseUrl);

        // 記錄通知
        if (result.success) {
            const stmt = db.prepare(`
                INSERT INTO notification_logs (inventory_id, message, status)
                VALUES (?, ?, 'sent')
            `);
            
            items.forEach(item => {
                stmt.run(item.id, `效期提醒：${item.name} 將於 ${item.expiry_date} 到期`);
            });
        }

        return {
            ...result,
            count: items.length,
            items: items.map(i => ({
                id: i.id,
                name: i.name,
                expiry_date: i.expiry_date
            }))
        };
    }

    /**
     * 發送明天到期商品提醒（可愛俏皮版）
     */
    async function sendTomorrowExpiryNotifications(baseUrl = null) {
        const settings = getNotificationSettings();
        
        // 檢查是否啟用通知
        if (settings.notification_enabled !== 'true') {
            console.log('通知功能已停用');
            return { success: false, message: '通知功能已停用' };
        }

        const items = getTomorrowExpiringItems();
        const client = lineBot.getClient();
        const lineSettings = lineBot.getLineSettings();
        
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
            
            message = `💡 明天有 ${items.length} 個商品要到期：\n\n${itemList}\n\n先記下來，明天別忘了處理喔～ 📝`;
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
     * 取得已過期但未處理的商品
     */
    function getExpiredItems() {
        return db.prepare(`
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
            AND i.expiry_date <= datetime('now')
            ORDER BY i.expiry_date ASC
        `).all();
    }

    /**
     * 發送已過期商品提醒（可愛俏皮版）
     */
    async function sendExpiredNotifications(baseUrl = null) {
        const items = getExpiredItems();

        if (items.length === 0) {
            return { success: true, message: '沒有已過期的商品', count: 0 };
        }

        const client = lineBot.getClient();
        const settings = lineBot.getLineSettings();

        if (!client || !settings || !settings.group_id) {
            return { success: false, error: 'LINE Bot 未設定' };
        }

        try {
            const itemList = items.slice(0, 5).map(i => `• ${i.name}`).join('\n');
            await client.pushMessage({
                to: settings.group_id,
                messages: [{
                    type: 'text',
                    text: `🚨 哎呀！有 ${items.length} 個商品過期了！\n\n${itemList}\n\n趕快去下架處理一下吧～ 💨`
                }]
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
