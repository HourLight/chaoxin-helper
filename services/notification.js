/**
 * 通知服務 (PostgreSQL 版本)
 */

module.exports = function(db) {
    const lineBot = require('./line-bot')(db);

    async function getNotificationSettings() {
        const result = await db.query('SELECT key, value FROM settings');
        const settingsObj = {};
        result.rows.forEach(s => { settingsObj[s.key] = s.value; });
        return settingsObj;
    }

    async function getExpiringItems(hours = 24) {
        const result = await db.query(`
            SELECT i.id, i.quantity, i.expiry_date, i.created_at, p.barcode, p.name, p.category, p.storage_temp
            FROM inventory i JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock'
            AND i.expiry_date <= NOW() + INTERVAL '1 hour' * $1
            AND i.expiry_date > NOW()
            ORDER BY i.expiry_date ASC
        `, [hours]);
        return result.rows;
    }

    async function getTomorrowExpiringItems() {
        const result = await db.query(`
            SELECT i.id, i.quantity, i.expiry_date, i.created_at, p.barcode, p.name, p.category, p.storage_temp
            FROM inventory i JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock'
            AND DATE(i.expiry_date) = CURRENT_DATE + INTERVAL '1 day'
            ORDER BY i.expiry_date ASC
        `);
        return result.rows;
    }

    async function sendExpiryNotifications(baseUrl = null) {
        const settings = await getNotificationSettings();
        if (settings.notification_enabled !== 'true') {
            console.log('通知功能已停用');
            return { success: false, message: '通知功能已停用' };
        }

        const hours = parseInt(settings.notification_hours_before) || 24;
        const items = await getExpiringItems(hours);

        if (items.length === 0) {
            console.log('沒有即將到期的商品');
            return { success: true, message: '沒有即將到期的商品', count: 0 };
        }

        console.log(`找到 ${items.length} 個即將到期的商品`);
        const result = await lineBot.sendExpiryAlert(items, baseUrl);

        if (result.success) {
            for (const item of items) {
                await db.query('INSERT INTO notification_logs (inventory_id, message, status) VALUES ($1, $2, $3)',
                    [item.id, `效期提醒：${item.name} 將於 ${item.expiry_date} 到期`, 'sent']);
            }
        }

        return { ...result, count: items.length, items: items.map(i => ({ id: i.id, name: i.name, expiry_date: i.expiry_date })) };
    }

    async function sendTomorrowExpiryNotifications(baseUrl = null) {
        const settings = await getNotificationSettings();
        if (settings.notification_enabled !== 'true') return { success: false, message: '通知功能已停用' };

        const items = await getTomorrowExpiringItems();
        const client = await lineBot.getClient();
        const lineSettings = await lineBot.getLineSettings();
        
        let groupId = process.env.LINE_GROUP_ID;
        if (lineSettings && lineSettings.group_id) groupId = lineSettings.group_id;
        if (!client || !groupId) return { success: false, error: 'LINE Bot 未設定' };

        let message;
        if (items.length === 0) {
            message = `✨ 明天沒有商品要到期喔～\n\n但還是去巡一下貨架比較安心啦！😊`;
        } else {
            const itemList = items.slice(0, 10).map((item, i) => `  ${i+1}. ${item.name}（${item.quantity}個）`).join('\n');
            message = `💡 明天有 ${items.length} 個商品要到期：\n\n${itemList}\n\n先記下來，明天別忘了處理喔～ 📝`;
        }

        try {
            await client.pushMessage({ to: groupId, messages: [{ type: 'text', text: message }] });
            return { success: true, count: items.length };
        } catch (error) {
            console.error('發送明天到期提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    async function getExpiredItems() {
        const result = await db.query(`
            SELECT i.id, i.quantity, i.expiry_date, p.barcode, p.name, p.category, p.storage_temp
            FROM inventory i JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock' AND i.expiry_date <= NOW()
            ORDER BY i.expiry_date ASC
        `);
        return result.rows;
    }

    async function sendExpiredNotifications(baseUrl = null) {
        const items = await getExpiredItems();
        if (items.length === 0) return { success: true, message: '沒有已過期的商品', count: 0 };

        const client = await lineBot.getClient();
        const settings = await lineBot.getLineSettings();
        if (!client || !settings || !settings.group_id) return { success: false, error: 'LINE Bot 未設定' };

        try {
            const itemList = items.slice(0, 5).map(i => `• ${i.name}`).join('\n');
            await client.pushMessage({
                to: settings.group_id,
                messages: [{ type: 'text', text: `🚨 哎呀！有 ${items.length} 個商品過期了！\n\n${itemList}\n\n趕快去下架處理一下吧～ 💨` }]
            });
            return { success: true, count: items.length };
        } catch (error) {
            console.error('發送已過期提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    return { getNotificationSettings, getExpiringItems, getTomorrowExpiringItems, getExpiredItems, sendExpiryNotifications, sendTomorrowExpiryNotifications, sendExpiredNotifications };
};
