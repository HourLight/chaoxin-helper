/**
 * 通知服務 (PostgreSQL 版本)
 * 
 * 提醒機制：
 * - 效期時間：當日 23:00
 * - 三次提醒：09:00（溫和）、14:00（中等）、22:00（緊急）
 * - 越接近越醒目
 */

module.exports = function(db) {
    const lineBot = require('./line-bot')(db);

    async function getNotificationSettings() {
        const result = await db.query('SELECT key, value FROM settings');
        const settingsObj = {};
        result.rows.forEach(s => { settingsObj[s.key] = s.value; });
        return settingsObj;
    }

    // 取得今日到期的商品（效期在今天 23:00 前的）
    async function getTodayExpiringItems() {
        // 今天結束前（23:59:59）到期的商品
        const result = await db.query(`
            SELECT i.id, i.quantity, i.expiry_date, i.created_at, p.barcode, p.name, p.category, p.storage_temp
            FROM inventory i JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock'
            AND DATE(i.expiry_date) = CURRENT_DATE
            ORDER BY i.expiry_date ASC
        `);
        return result.rows;
    }

    // 取得已過期的商品
    async function getExpiredItems() {
        const result = await db.query(`
            SELECT i.id, i.quantity, i.expiry_date, p.barcode, p.name, p.category, p.storage_temp
            FROM inventory i JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock' AND i.expiry_date < NOW()
            ORDER BY i.expiry_date ASC
        `);
        return result.rows;
    }

    // 取得明天到期的商品
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

    // 舊版相容：取得 N 小時內到期的商品
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

    /**
     * 早上 9 點提醒（第一次，溫和提醒）
     */
    async function sendMorningReminder(baseUrl = null) {
        const settings = await getNotificationSettings();
        if (settings.notification_enabled !== 'true') {
            return { success: false, message: '通知功能已停用' };
        }

        const todayItems = await getTodayExpiringItems();
        const expiredItems = await getExpiredItems();
        
        if (todayItems.length === 0 && expiredItems.length === 0) {
            return { success: true, message: '沒有需要處理的商品', count: 0 };
        }

        const client = await lineBot.getClient();
        const lineSettings = await lineBot.getLineSettings();
        let groupId = process.env.LINE_GROUP_ID;
        if (lineSettings && lineSettings.group_id) groupId = lineSettings.group_id;
        if (!client || !groupId) return { success: false, error: 'LINE Bot 未設定' };

        // 組合訊息 - 溫和版本
        const messages = [];
        
        if (expiredItems.length > 0) {
            const expiredList = expiredItems.slice(0, 5).map(i => `  • ${i.name}`).join('\n');
            messages.push({
                type: 'text',
                text: `☀️ 早安！開工前先處理一下～\n\n⚠️ 有 ${expiredItems.length} 個商品已過期：\n${expiredList}${expiredItems.length > 5 ? '\n  ...還有更多' : ''}\n\n請盡快下架處理喔！`
            });
        }
        
        if (todayItems.length > 0) {
            const todayList = todayItems.slice(0, 8).map(i => `  • ${i.name}（${i.quantity}個）`).join('\n');
            messages.push({
                type: 'text',
                text: `📅 今天有 ${todayItems.length} 個商品要到期：\n\n${todayList}${todayItems.length > 8 ? '\n  ...還有更多' : ''}\n\n⏰ 記得在 23:00 前處理完畢！\n💡 下午 2 點會再提醒一次`
            });
        }

        try {
            await client.pushMessage({ to: groupId, messages });
            console.log(`✅ 早上提醒已發送：今日到期 ${todayItems.length}，已過期 ${expiredItems.length}`);
            return { success: true, todayCount: todayItems.length, expiredCount: expiredItems.length };
        } catch (error) {
            console.error('發送早上提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 下午 2 點提醒（第二次，中等提醒）
     */
    async function sendAfternoonReminder(baseUrl = null) {
        const settings = await getNotificationSettings();
        if (settings.notification_enabled !== 'true') {
            return { success: false, message: '通知功能已停用' };
        }

        const todayItems = await getTodayExpiringItems();
        const expiredItems = await getExpiredItems();
        
        if (todayItems.length === 0 && expiredItems.length === 0) {
            return { success: true, message: '沒有需要處理的商品', count: 0 };
        }

        const client = await lineBot.getClient();
        const lineSettings = await lineBot.getLineSettings();
        let groupId = process.env.LINE_GROUP_ID;
        if (lineSettings && lineSettings.group_id) groupId = lineSettings.group_id;
        if (!client || !groupId) return { success: false, error: 'LINE Bot 未設定' };

        // 組合訊息 - 中等緊急版本
        const totalCount = todayItems.length + expiredItems.length;
        const itemList = [...expiredItems, ...todayItems].slice(0, 10);
        const listText = itemList.map((i, idx) => {
            const isExpired = expiredItems.includes(i);
            return `  ${idx + 1}. ${isExpired ? '❌' : '⚠️'} ${i.name}`;
        }).join('\n');

        const message = {
            type: 'flex',
            altText: `⚠️ 效期提醒：還有 ${totalCount} 個商品待處理`,
            contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#F39C12',
                    paddingAll: '15px',
                    contents: [
                        { type: 'text', text: '⚠️ 下午效期提醒', color: '#FFFFFF', weight: 'bold', size: 'lg' },
                        { type: 'text', text: `還有 ${totalCount} 個商品需要處理！`, color: '#FFFFFF', size: 'sm', margin: 'sm' }
                    ]
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    paddingAll: '15px',
                    contents: [
                        { type: 'text', text: listText, size: 'sm', wrap: true },
                        { type: 'separator', margin: 'md' },
                        { type: 'text', text: '⏰ 距離 23:00 截止還有 9 小時', size: 'xs', color: '#E74C3C', margin: 'md' },
                        { type: 'text', text: '💡 晚上 10 點會發最後提醒', size: 'xs', color: '#888888', margin: 'sm' }
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    paddingAll: '10px',
                    contents: [
                        {
                            type: 'button',
                            style: 'primary',
                            color: '#F39C12',
                            action: { type: 'uri', label: '👉 前往處理', uri: (baseUrl || process.env.BASE_URL || 'https://chaoxin-helper.onrender.com') + '/inventory' }
                        }
                    ]
                }
            }
        };

        try {
            await client.pushMessage({ to: groupId, messages: [message] });
            console.log(`✅ 下午提醒已發送：${totalCount} 個商品待處理`);
            return { success: true, count: totalCount };
        } catch (error) {
            console.error('發送下午提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 晚上 10 點提醒（第三次，緊急提醒）
     */
    async function sendUrgentReminder(baseUrl = null) {
        const settings = await getNotificationSettings();
        if (settings.notification_enabled !== 'true') {
            return { success: false, message: '通知功能已停用' };
        }

        const todayItems = await getTodayExpiringItems();
        const expiredItems = await getExpiredItems();
        
        if (todayItems.length === 0 && expiredItems.length === 0) {
            // 全部處理完了！發送正向訊息
            const client = await lineBot.getClient();
            const lineSettings = await lineBot.getLineSettings();
            let groupId = process.env.LINE_GROUP_ID;
            if (lineSettings && lineSettings.group_id) groupId = lineSettings.group_id;
            if (client && groupId) {
                await client.pushMessage({ 
                    to: groupId, 
                    messages: [{ type: 'text', text: '🎉 太棒了！今天的效期商品都處理完畢！\n\n辛苦了，早點休息喔～ 💚' }] 
                });
            }
            return { success: true, message: '全部處理完成！', count: 0 };
        }

        const client = await lineBot.getClient();
        const lineSettings = await lineBot.getLineSettings();
        let groupId = process.env.LINE_GROUP_ID;
        if (lineSettings && lineSettings.group_id) groupId = lineSettings.group_id;
        if (!client || !groupId) return { success: false, error: 'LINE Bot 未設定' };

        // 組合訊息 - 緊急版本（紅色警告）
        const totalCount = todayItems.length + expiredItems.length;
        const itemList = [...expiredItems, ...todayItems].slice(0, 10);
        const listText = itemList.map((i, idx) => `${idx + 1}. ${i.name}`).join('\n');

        const message = {
            type: 'flex',
            altText: `🚨 緊急！還有 ${totalCount} 個商品未處理！`,
            contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#E74C3C',
                    paddingAll: '20px',
                    contents: [
                        { type: 'text', text: '🚨🚨🚨 緊急提醒 🚨🚨🚨', color: '#FFFFFF', weight: 'bold', size: 'xl', align: 'center' },
                        { type: 'text', text: `還有 ${totalCount} 個商品要處理！`, color: '#FFFFFF', size: 'lg', align: 'center', margin: 'md', weight: 'bold' }
                    ]
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'md',
                    paddingAll: '15px',
                    backgroundColor: '#FFF5F5',
                    contents: [
                        { type: 'text', text: '⚠️ 待處理商品：', size: 'md', weight: 'bold', color: '#E74C3C' },
                        { type: 'text', text: listText, size: 'sm', wrap: true, margin: 'sm' },
                        { type: 'separator', margin: 'md' },
                        { type: 'box', layout: 'vertical', margin: 'md', contents: [
                            { type: 'text', text: '⏰ 距離 23:00 只剩 1 小時！', size: 'md', color: '#E74C3C', weight: 'bold', align: 'center' },
                            { type: 'text', text: '請立即處理！', size: 'lg', color: '#E74C3C', weight: 'bold', align: 'center', margin: 'sm' }
                        ]}
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    paddingAll: '15px',
                    contents: [
                        {
                            type: 'button',
                            style: 'primary',
                            color: '#E74C3C',
                            height: 'md',
                            action: { type: 'uri', label: '🔥 立即前往處理 🔥', uri: (baseUrl || process.env.BASE_URL || 'https://chaoxin-helper.onrender.com') + '/inventory' }
                        }
                    ]
                }
            }
        };

        try {
            await client.pushMessage({ to: groupId, messages: [message] });
            console.log(`🚨 緊急提醒已發送：${totalCount} 個商品待處理`);
            return { success: true, count: totalCount };
        } catch (error) {
            console.error('發送緊急提醒失敗:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 舊版相容：發送效期提醒
     */
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

    return { 
        getNotificationSettings, 
        getExpiringItems, 
        getTodayExpiringItems,
        getTomorrowExpiringItems, 
        getExpiredItems, 
        sendExpiryNotifications, 
        sendTomorrowExpiryNotifications, 
        sendExpiredNotifications,
        // 新增三次提醒
        sendMorningReminder,      // 09:00
        sendAfternoonReminder,    // 14:00
        sendUrgentReminder        // 22:00
    };
};
