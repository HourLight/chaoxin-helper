/**
 * LINE Bot 服務 (PostgreSQL 版本)
 * 處理 LINE 訊息和互動
 * 潮欣小幫手 v1.0.0
 */

const line = require('@line/bot-sdk');
const aiRecognition = require('./ai-recognition');

// 官方帳號 ID（用於私訊連結）
const LINE_OA_ID = process.env.LINE_OA_ID || '@296eywni';

module.exports = function(db) {
    // 引入遊戲化和抽籤服務
    const gamificationService = require('./gamification')(db);
    const fortuneService = require('./fortune')(db);
    
    /**
     * 取得 LINE 設定
     */
    async function getLineSettings() {
        const result = await db.query(
            'SELECT * FROM line_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
        );
        return result.rows[0];
    }

    /**
     * 取得 LINE Client
     */
    async function getClient() {
        const settings = await getLineSettings();
        if (!settings || !settings.channel_access_token) {
            const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
            if (token) {
                return new line.messagingApi.MessagingApiClient({
                    channelAccessToken: token
                });
            }
            return null;
        }
        return new line.messagingApi.MessagingApiClient({
            channelAccessToken: settings.channel_access_token
        });
    }

    /**
     * 處理 LINE 事件
     */
    async function handleEvent(event) {
        const client = await getClient();
        if (!client) return null;

        if (event.type === 'postback') {
            return handlePostback(event, client);
        }
        if (event.type === 'message' && event.message.type === 'image') {
            return handleImageMessage(event, client);
        }
        if (event.type === 'message' && event.message.type === 'text') {
            return handleTextMessage(event, client);
        }
        return null;
    }

    /**
     * 處理 Postback 事件
     */
    async function handlePostback(event, client) {
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');
        const inventoryId = data.get('id');
        const userId = event.source.userId;

        let userName = '店員';
        if (userId) {
            try {
                const profile = await client.getProfile(userId);
                userName = profile.displayName;
                await db.query(
                    'INSERT INTO staff (user_id, display_name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP',
                    [userId, userName]
                );
            } catch (e) { /* 可能在群組中無法取得 */ }
        }

        // ========== 處理員工認領 ==========
        if (action === 'claim_employee') {
            const employeeId = data.get('id');
            const employeeName = decodeURIComponent(data.get('name') || '');
            
            try {
                // 檢查是否已被其他人綁定
                const checkResult = await db.query(
                    'SELECT line_user_id FROM employees WHERE id = $1',
                    [employeeId]
                );
                
                if (checkResult.rows.length > 0 && checkResult.rows[0].line_user_id) {
                    await client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [{ type: 'text', text: `😅 「${employeeName}」已經被其他人認領了喔！\n\n如有問題請聯絡店長～` }]
                    });
                    return null;
                }

                // 綁定 LINE 帳號
                await db.query(
                    'UPDATE employees SET line_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [userId, employeeId]
                );

                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ 
                        type: 'text', 
                        text: `🎉 綁定成功！\n\n你好，${employeeName}！\n\n現在你可以：\n• 輸入「班表」查看你的排班\n• 輸入「今天」查看今天上班的夥伴\n\n有問題隨時問我喔～ 💪` 
                    }]
                });
            } catch (error) {
                console.error('員工認領錯誤:', error);
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '綁定時發生錯誤，請稍後再試～' }]
                });
            }
            return null;
        }

        // 處理「找不到（已售出）」按鈕
        if (action === 'sold' && inventoryId) {
            const itemResult = await db.query('SELECT p.name FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.id = $1', [inventoryId]);
            const productName = itemResult.rows[0] ? itemResult.rows[0].name : '商品';
            await db.query('UPDATE inventory SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['sold', inventoryId]);
            await db.query('INSERT INTO operation_logs (user_id, user_name, action, inventory_id, product_name, details, source) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [userId || 'unknown', userName, 'sold', inventoryId, productName, '到期前售出', 'line']);
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '✨ 太棒了！「' + productName + '」在到期前就賣掉了！\n\n📝 操作者：' + userName + '\n這表示進貨量剛剛好 👍' }]
            });
            return null;
        }

        // 處理「找到了（已下架）」按鈕
        if (action === 'remove' && inventoryId) {
            const itemResult = await db.query('SELECT p.name FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.id = $1', [inventoryId]);
            const productName = itemResult.rows[0] ? itemResult.rows[0].name : '商品';
            await db.query('UPDATE inventory SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['disposed', inventoryId]);
            await db.query('INSERT INTO operation_logs (user_id, user_name, action, inventory_id, product_name, details, source) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [userId || 'unknown', userName, 'disposed', inventoryId, productName, '到期下架報廢', 'line']);
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '📦 已標記「' + productName + '」為已下架\n\n📝 操作者：' + userName + '\n辛苦了～這筆會記錄起來，之後可以參考調整進貨量 💪' }]
            });
            return null;
        }

        // 處理「確認登記」按鈕
        if (action === 'confirm_register') {
            const barcode = data.get('barcode') || null;
            const name = data.get('name');
            const expiry = data.get('expiry');
            const temp = data.get('temp') || 'refrigerated';
            const category = data.get('category') || null;
            const quantity = parseInt(data.get('qty')) || 1;

            if (!name || !expiry) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '😅 缺少必要資訊（商品名稱或效期），請到網頁手動登記喔～' }] });
                return null;
            }

            try {
                let productId = null;
                if (barcode) {
                    const existingResult = await db.query('SELECT id FROM products WHERE barcode = $1', [barcode]);
                    if (existingResult.rows.length > 0) productId = existingResult.rows[0].id;
                }
                if (!productId) {
                    const result = await db.query('INSERT INTO products (barcode, name, category, storage_temp) VALUES ($1, $2, $3, $4) RETURNING id', [barcode, name, category, temp]);
                    productId = result.rows[0].id;
                }
                await db.query('INSERT INTO inventory (product_id, quantity, expiry_date, status) VALUES ($1, $2, $3, $4)', [productId, quantity, expiry, 'in_stock']);
                if (userId) {
                    try { await gamificationService.addXP(userId, 20, 'product_register', 'LINE 登記: ' + name); } catch (e) { console.error('XP 獎勵失敗:', e); }
                }

                const expiryDate = new Date(expiry);
                const now = new Date();
                const diffDays = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                let expiryText = diffDays < 0 ? '（已過期 ' + Math.abs(diffDays) + ' 天）' : diffDays === 0 ? '（今天到期！）' : diffDays === 1 ? '（明天到期）' : '（還有 ' + diffDays + ' 天）';

                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'flex', altText: '🎉 登記成功！',
                        contents: {
                            type: 'bubble', size: 'kilo',
                            header: { type: 'box', layout: 'vertical', backgroundColor: '#1DB446', paddingAll: '12px', contents: [{ type: 'text', text: '🎉 登記成功！', color: '#FFFFFF', weight: 'bold', size: 'md' }] },
                            body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                                { type: 'text', text: name, weight: 'bold', size: 'lg', wrap: true },
                                { type: 'text', text: '📅 效期：' + expiryDate.toLocaleDateString('zh-TW') + ' ' + expiryText, size: 'sm', color: diffDays <= 1 ? '#E74C3C' : '#666666' },
                                { type: 'text', text: '📦 數量：' + quantity, size: 'sm', color: '#666666' },
                                { type: 'separator', margin: 'md' },
                                { type: 'text', text: '辛苦了！+20 XP ⭐', size: 'sm', color: '#9B59B6', margin: 'md' }
                            ]}
                        }
                    }]
                });
            } catch (error) {
                console.error('LINE 登記失敗:', error);
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '😅 登記失敗：' + error.message + '\n請到網頁手動登記喔～' }] });
            }
            return null;
        }

        // 處理「修改數量」按鈕
        if (action === 'change_qty') {
            const barcode = data.get('barcode') || '';
            const name = data.get('name');
            const expiry = data.get('expiry');
            const temp = data.get('temp') || 'refrigerated';
            const category = data.get('category') || '';
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'flex', altText: '選擇數量', contents: createQuantitySelector(barcode, name, expiry, temp, category) }] });
            return null;
        }

        return null;
    }

    function createQuantitySelector(barcode, name, expiry, temp, category) {
        const quantities = [1, 2, 3, 5, 10];
        const buttons = quantities.map(qty => ({
            type: 'button', style: 'secondary', height: 'sm',
            action: { type: 'postback', label: qty + ' 個', data: 'action=confirm_register&barcode=' + encodeURIComponent(barcode) + '&name=' + encodeURIComponent(name) + '&expiry=' + encodeURIComponent(expiry) + '&temp=' + temp + '&category=' + encodeURIComponent(category) + '&qty=' + qty }
        }));
        return {
            type: 'bubble', size: 'kilo',
            header: { type: 'box', layout: 'vertical', backgroundColor: '#F7941D', paddingAll: '12px', contents: [{ type: 'text', text: '📦 選擇數量', color: '#FFFFFF', weight: 'bold', size: 'md' }] },
            body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                { type: 'text', text: name, weight: 'bold', size: 'md', wrap: true },
                { type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', contents: buttons.slice(0, 3) },
                { type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm', contents: [...buttons.slice(3), { type: 'filler' }] }
            ]}
        };
    }

    /**
     * 處理圖片訊息 - AI 辨識
     */
    async function handleImageMessage(event, client) {
        const messageId = event.message.id;
        const baseUrl = process.env.BASE_URL || 'https://chaoxin-helper.onrender.com';
        const isGroup = event.source.type === 'group';

        if (isGroup) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'flex', altText: '📸 私訊我拍照登記！',
                    contents: {
                        type: 'bubble', size: 'kilo',
                        body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
                            { type: 'text', text: '📸 收到照片！', weight: 'bold', size: 'lg', align: 'center' },
                            { type: 'text', text: '但群組不處理登記喔～\n請私訊我傳照片，這樣群組比較乾淨！', size: 'sm', color: '#666666', align: 'center', wrap: true, margin: 'md' }
                        ]},
                        footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'button', action: { type: 'uri', label: '👉 點我私訊拍照', uri: 'https://line.me/R/oaMessage/' + LINE_OA_ID + '/?拍照' }, style: 'primary', color: '#1DB446', height: 'sm' }] }
                    }
                }]
            });
            return null;
        }

        try {
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '📸 收到照片！正在辨識中...\n請稍等一下喔～ ⏳' }] });
            const result = await aiRecognition.recognizeFromLineImage(messageId);
            const barcode = result.barcode?.value || '';
            const name = result.name?.value || '';
            const expiry = result.expiry_date?.value || '';
            const temp = result.storage_temp || 'refrigerated';
            const category = result.category || '';

            if (!name && !expiry) {
                const targetId = event.source.groupId || event.source.userId;
                await client.pushMessage({ to: targetId, messages: [{ type: 'text', text: '😅 沒有辨識到商品資訊\n\n請確保照片中有：\n📦 商品名稱\n📅 有效期限\n\n或到網頁手動登記：\n' + baseUrl + '/smart-register' }] });
                return null;
            }
            if (result.mock) {
                const targetId = event.source.groupId || event.source.userId;
                await client.pushMessage({ to: targetId, messages: [{ type: 'text', text: '⚠️ 目前為模擬模式\n\n請到網頁手動登記：\n' + baseUrl + '/smart-register' }] });
                return null;
            }

            const targetId = event.source.groupId || event.source.userId;
            await client.pushMessage({ to: targetId, messages: [{ type: 'flex', altText: '辨識結果：' + (name || '商品'), contents: createRecognitionResultCard(result, baseUrl) }] });
        } catch (error) {
            console.error('圖片辨識失敗:', error);
            const targetId = event.source.groupId || event.source.userId;
            await client.pushMessage({ to: targetId, messages: [{ type: 'text', text: '😅 辨識失敗了...\n\n錯誤：' + error.message + '\n\n請到網頁手動登記：\n' + baseUrl + '/smart-register' }] });
        }
        return null;
    }

    function createRecognitionResultCard(result, baseUrl) {
        const barcode = result.barcode?.value || '';
        const name = result.name?.value || '未知商品';
        const expiry = result.expiry_date?.value || '';
        const temp = result.storage_temp || 'refrigerated';
        const category = result.category || '';
        const tempMap = { 'refrigerated': '❄️ 冷藏', 'frozen': '🧊 冷凍', 'room_temp': '🌡️ 常溫' };

        let expiryDisplay = '未辨識', expiryColor = '#666666';
        if (expiry) {
            const expiryDate = new Date(expiry);
            const diffDays = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
            expiryDisplay = expiryDate.toLocaleDateString('zh-TW');
            if (diffDays <= 0) { expiryDisplay += ' ⚠️ 已過期'; expiryColor = '#E74C3C'; }
            else if (diffDays <= 1) { expiryDisplay += ' ⚠️ 明天到期'; expiryColor = '#E74C3C'; }
            else if (diffDays <= 3) { expiryDisplay += ' (' + diffDays + '天)'; expiryColor = '#F39C12'; }
            else { expiryDisplay += ' (' + diffDays + '天)'; }
        }

        const getConfIcon = (conf) => !conf ? '' : conf >= 0.8 ? ' ✅' : conf >= 0.5 ? ' ⚠️' : ' ❓';
        const contents = [
            { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '🏷️ 商品', size: 'sm', color: '#888888', flex: 2 }, { type: 'text', text: name + getConfIcon(result.name?.confidence), size: 'sm', weight: 'bold', flex: 5, wrap: true }] },
            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '📅 效期', size: 'sm', color: '#888888', flex: 2 }, { type: 'text', text: expiryDisplay + getConfIcon(result.expiry_date?.confidence), size: 'sm', color: expiryColor, flex: 5 }] }
        ];
        if (barcode) contents.push({ type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '📦 條碼', size: 'sm', color: '#888888', flex: 2 }, { type: 'text', text: barcode + getConfIcon(result.barcode?.confidence), size: 'sm', flex: 5 }] });
        contents.push({ type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '🌡️ 溫層', size: 'sm', color: '#888888', flex: 2 }, { type: 'text', text: tempMap[temp] || '冷藏', size: 'sm', flex: 5 }] });

        const postbackData = 'action=confirm_register&barcode=' + encodeURIComponent(barcode) + '&name=' + encodeURIComponent(name) + '&expiry=' + encodeURIComponent(expiry) + '&temp=' + temp + '&category=' + encodeURIComponent(category) + '&qty=1';
        const changeQtyData = 'action=change_qty&barcode=' + encodeURIComponent(barcode) + '&name=' + encodeURIComponent(name) + '&expiry=' + encodeURIComponent(expiry) + '&temp=' + temp + '&category=' + encodeURIComponent(category);
        const params = new URLSearchParams();
        if (barcode) params.append('barcode', barcode);
        if (name) params.append('name', name);
        if (expiry) params.append('expiry', expiry);
        if (temp) params.append('temp', temp);
        if (category) params.append('category', category);
        const webUrl = baseUrl + '/smart-register?' + params.toString();

        return {
            type: 'bubble', size: 'mega',
            header: { type: 'box', layout: 'vertical', backgroundColor: '#F7941D', paddingAll: '15px', contents: [
                { type: 'text', text: '✨ 辨識完成！', color: '#FFFFFF', weight: 'bold', size: 'lg' },
                { type: 'text', text: '確認資訊無誤後，點擊下方按鈕登記', color: '#FFFFFF', size: 'xs', margin: 'sm' }
            ]},
            body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '15px', contents: contents },
            footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '15px', contents: [
                { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
                    { type: 'button', style: 'primary', color: '#1DB446', action: { type: 'postback', label: '✅ 確認登記', data: postbackData }, flex: 2 },
                    { type: 'button', style: 'secondary', action: { type: 'postback', label: '📦 改數量', data: changeQtyData }, flex: 1 }
                ]},
                { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '✏️ 去網頁修改更多', uri: webUrl } }
            ]}
        };
    }

    /**
     * 處理文字訊息
     */
    async function handleTextMessage(event, client) {
        const text = event.message.text.toLowerCase();
        const baseUrl = process.env.BASE_URL || 'https://chaoxin-helper.onrender.com';

        // 主選單關鍵字
        const menuKeywords = ['潮欣小幫手', '小幫手', '店長助理', '小助理', '小妞', '潮欣小妞', '幫助', 'help', '選單', 'menu', '功能', '可以做什麼', '有什麼功能'];
        if (menuKeywords.some(keyword => text.includes(keyword))) {
            await client.replyMessage({ replyToken: event.replyToken, messages: [createMenuFlexMessage(baseUrl)] });
            return;
        }

        // 打招呼
        const greetings = ['你好', '嗨', 'hi', 'hello', '哈囉', '安安', '在嗎'];
        if (greetings.some(g => text.includes(g))) {
            const hour = new Date().getHours();
            const timeGreeting = hour >= 5 && hour < 12 ? '早安' : hour >= 12 && hour < 18 ? '午安' : '晚安';
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: timeGreeting + '～我是潮欣小幫手！🏪\n\n有什麼需要幫忙的嗎？\n輸入「選單」可以看到所有功能喔～' }] });
            return;
        }

        // 📢 公告查詢
        if (text.includes('公告') || text.includes('布告') || text.includes('通知')) {
            try {
                const result = await db.query(
                    'SELECT * FROM announcements WHERE is_active = true ORDER BY updated_at DESC LIMIT 1'
                );
                
                if (result.rows.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ type: 'text', text: '📭 目前沒有公告喔～' }] 
                    });
                    return;
                }

                const announcement = result.rows[0];
                const date = new Date(announcement.updated_at);
                const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{
                        type: 'flex',
                        altText: '📢 店長公告',
                        contents: {
                            type: 'bubble',
                            size: 'kilo',
                            header: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#FF6B35',
                                paddingAll: '15px',
                                contents: [
                                    { type: 'text', text: '📢 店長公告', weight: 'bold', size: 'lg', color: '#FFFFFF', align: 'center' }
                                ]
                            },
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                paddingAll: '15px',
                                contents: [
                                    { type: 'text', text: announcement.content, wrap: true, size: 'md' },
                                    { type: 'text', text: `👤 ${announcement.created_by || '店長'} · ${timeStr}`, size: 'xs', color: '#999999', margin: 'lg' }
                                ]
                            }
                        }
                    }]
                });
            } catch (error) {
                console.error('公告查詢錯誤:', error);
                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: '公告查詢暫時有問題，請稍後再試～' }] 
                });
            }
            return;
        }

        // 📊 今日總覽（店顧問/店長專用）
        if (text.includes('總覽') || text.includes('店況') || text.includes('今日狀況') || text === '報告') {
            try {
                const userId = event.source.userId;
                let displayName = '訪客';
                try { const profile = await client.getProfile(userId); displayName = profile.displayName; } catch (e) { }

                // 1. 今天班表
                const todaySchedule = await db.query(`
                    SELECT e.name, st.name as shift_name, st.start_time, st.end_time
                    FROM schedules s
                    JOIN employees e ON s.employee_id = e.id
                    LEFT JOIN shift_types st ON s.shift_type = st.code
                    WHERE s.work_date = CURRENT_DATE
                    AND e.is_active = true AND s.shift_type != 'off'
                    ORDER BY st.sort_order
                `);

                // 2. 效期狀況
                const expiryStats = await db.query(`
                    SELECT 
                        COUNT(*) FILTER (WHERE expiry_date < NOW()) as expired,
                        COUNT(*) FILTER (WHERE expiry_date >= NOW() AND expiry_date < NOW() + INTERVAL '24 hours') as today,
                        COUNT(*) FILTER (WHERE expiry_date >= NOW() + INTERVAL '24 hours' AND expiry_date < NOW() + INTERVAL '3 days') as soon,
                        COUNT(*) as total
                    FROM inventory WHERE status = 'in_stock'
                `);
                const stats = expiryStats.rows[0];

                // 3. 今日操作紀錄
                const todayOps = await db.query(`
                    SELECT user_name, action, COUNT(*) as count
                    FROM operation_logs
                    WHERE DATE(created_at) = CURRENT_DATE
                    GROUP BY user_name, action
                    ORDER BY count DESC
                `);

                // 4. 今日簽到
                const checkinCount = await db.query(`
                    SELECT COUNT(DISTINCT user_id) as count
                    FROM user_stats
                    WHERE DATE(last_checkin) = CURRENT_DATE
                `);

                // 組織訊息
                let scheduleText = '';
                if (todaySchedule.rows.length > 0) {
                    const grouped = {};
                    todaySchedule.rows.forEach(r => {
                        if (!grouped[r.shift_name]) grouped[r.shift_name] = [];
                        grouped[r.shift_name].push(r.name);
                    });
                    Object.entries(grouped).forEach(([shift, names]) => {
                        scheduleText += `${shift}：${names.join('、')}\n`;
                    });
                } else {
                    scheduleText = '尚未排班\n';
                }

                let opsText = '';
                if (todayOps.rows.length > 0) {
                    const actionMap = { 'disposed': '下架', 'sold': '售出', 'register': '登記' };
                    todayOps.rows.slice(0, 5).forEach(r => {
                        opsText += `• ${r.user_name}：${actionMap[r.action] || r.action} ${r.count} 件\n`;
                    });
                } else {
                    opsText = '今天還沒有操作紀錄\n';
                }

                const healthPercent = stats.total > 0 
                    ? Math.round((stats.total - stats.expired - stats.today) / stats.total * 100) 
                    : 100;

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{
                        type: 'flex',
                        altText: '📊 今日總覽',
                        contents: {
                            type: 'bubble',
                            size: 'mega',
                            header: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#1DB446',
                                paddingAll: '15px',
                                contents: [
                                    { type: 'text', text: '📊 今日店況總覽', weight: 'bold', size: 'lg', color: '#FFFFFF', align: 'center' },
                                    { type: 'text', text: new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }), size: 'sm', color: '#FFFFFF', align: 'center', margin: 'sm' }
                                ]
                            },
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                paddingAll: '15px',
                                spacing: 'lg',
                                contents: [
                                    { type: 'text', text: '👥 今日班表', weight: 'bold', size: 'md', color: '#1DB446' },
                                    { type: 'text', text: scheduleText.trim() || '無資料', size: 'sm', wrap: true },
                                    { type: 'separator', margin: 'lg' },
                                    { type: 'text', text: '📦 效期狀況', weight: 'bold', size: 'md', color: '#FF6B35', margin: 'lg' },
                                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                                        { type: 'text', text: '庫存健康度', size: 'sm', flex: 3 },
                                        { type: 'text', text: healthPercent + '%', size: 'sm', weight: 'bold', color: healthPercent >= 80 ? '#1DB446' : healthPercent >= 50 ? '#FF9800' : '#F44336', flex: 2, align: 'end' }
                                    ]},
                                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                                        { type: 'text', text: '🔴 已過期', size: 'xs', color: '#F44336', flex: 2 },
                                        { type: 'text', text: '🟠 24h內', size: 'xs', color: '#FF9800', flex: 2 },
                                        { type: 'text', text: '🟢 3天內', size: 'xs', color: '#4CAF50', flex: 2 }
                                    ]},
                                    { type: 'box', layout: 'horizontal', contents: [
                                        { type: 'text', text: (stats.expired || 0) + ' 件', size: 'sm', weight: 'bold', align: 'center', flex: 2 },
                                        { type: 'text', text: (stats.today || 0) + ' 件', size: 'sm', weight: 'bold', align: 'center', flex: 2 },
                                        { type: 'text', text: (stats.soon || 0) + ' 件', size: 'sm', weight: 'bold', align: 'center', flex: 2 }
                                    ]},
                                    { type: 'separator', margin: 'lg' },
                                    { type: 'text', text: '✅ 今日工作紀錄', weight: 'bold', size: 'md', color: '#9B59B6', margin: 'lg' },
                                    { type: 'text', text: opsText.trim() || '無紀錄', size: 'sm', wrap: true },
                                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                                        { type: 'text', text: '📝 今日簽到', size: 'xs', color: '#888888', flex: 3 },
                                        { type: 'text', text: (checkinCount.rows[0]?.count || 0) + ' 人', size: 'xs', flex: 2, align: 'end' }
                                    ]}
                                ]
                            },
                            footer: {
                                type: 'box',
                                layout: 'vertical',
                                paddingAll: '10px',
                                contents: [
                                    { type: 'text', text: '💚 大家都很努力喔！', size: 'xs', color: '#888888', align: 'center' }
                                ]
                            }
                        }
                    }]
                });
            } catch (error) {
                console.error('今日總覽錯誤:', error);
                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: '查詢總覽時發生錯誤，請稍後再試～' }] 
                });
            }
            return;
        }

        // 📦 效期查詢
        if (text.includes('效期') || text.includes('到期') || text.includes('即期') || text === '過期') {
            try {
                // 查詢即將到期商品（24小時內）
                const expiringResult = await db.query(`
                    SELECT p.name, i.expiry_date, i.quantity
                    FROM inventory i
                    JOIN products p ON i.product_id = p.id
                    WHERE i.status = 'in_stock'
                    AND i.expiry_date < NOW() + INTERVAL '24 hours'
                    ORDER BY i.expiry_date ASC
                    LIMIT 10
                `);

                if (expiringResult.rows.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ type: 'text', text: '✨ 太棒了！目前沒有即將到期的商品喔～\n\n繼續保持這個好狀態！💪' }] 
                    });
                    return;
                }

                let expiryText = '⚠️ 即期商品（24小時內）\n\n';
                expiringResult.rows.forEach((item, i) => {
                    const expiry = new Date(item.expiry_date);
                    const now = new Date();
                    const diffHours = Math.round((expiry - now) / (1000 * 60 * 60));
                    
                    let timeText = '';
                    if (diffHours < 0) {
                        timeText = `🔴 已過期 ${Math.abs(diffHours)} 小時`;
                    } else if (diffHours === 0) {
                        timeText = '🔴 即將到期！';
                    } else {
                        timeText = `🟠 剩 ${diffHours} 小時`;
                    }
                    
                    expiryText += `${i + 1}. ${item.name}\n   ${timeText}（${item.quantity}個）\n`;
                });

                expiryText += '\n👉 記得優先處理喔！';

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: expiryText }] 
                });
            } catch (error) {
                console.error('效期查詢錯誤:', error);
                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: '效期查詢時發生錯誤，請稍後再試～' }] 
                });
            }
            return;
        }

        // 📦 庫存查詢
        if (text.includes('庫存') || text.includes('有什麼') || text.includes('還有')) {
            try {
                const inventoryResult = await db.query(`
                    SELECT p.name, p.storage_temp, SUM(i.quantity) as total
                    FROM inventory i
                    JOIN products p ON i.product_id = p.id
                    WHERE i.status = 'in_stock'
                    GROUP BY p.id, p.name, p.storage_temp
                    ORDER BY total DESC
                    LIMIT 15
                `);

                const totalCount = await db.query(`
                    SELECT COUNT(*) as count, SUM(quantity) as total
                    FROM inventory WHERE status = 'in_stock'
                `);

                if (inventoryResult.rows.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ type: 'text', text: '📦 目前庫存是空的喔～' }] 
                    });
                    return;
                }

                const tempIcon = { 'refrigerated': '❄️', 'frozen': '🧊', 'room_temp': '🌡️' };
                let inventoryText = `📦 庫存概況\n\n`;
                inventoryText += `共 ${totalCount.rows[0].count} 筆 / ${totalCount.rows[0].total} 件\n\n`;
                
                inventoryResult.rows.forEach(item => {
                    const icon = tempIcon[item.storage_temp] || '📦';
                    inventoryText += `${icon} ${item.name}：${item.total} 件\n`;
                });

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: inventoryText }] 
                });
            } catch (error) {
                console.error('庫存查詢錯誤:', error);
                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: '庫存查詢時發生錯誤，請稍後再試～' }] 
                });
            }
            return;
        }

        // 🎮 簽到功能
        const checkinKeywords = ['簽到', '打卡', 'checkin', '報到'];
        if (checkinKeywords.some(keyword => text.includes(keyword))) {
            const userId = event.source.userId;
            if (!userId) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '😅 無法識別你的身份，請私訊我或加我為好友喔～' }] });
                return;
            }
            let displayName = '店員';
            try { const profile = await client.getProfile(userId); displayName = profile.displayName; } catch (e) { }

            const result = await gamificationService.dailyCheckin(userId, displayName);
            if (result.alreadyCheckedIn) {
                const gameData = await gamificationService.getUserGameData(userId);
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'flex', altText: '今天已經簽到過囉！',
                        contents: {
                            type: 'bubble', size: 'kilo',
                            header: { type: 'box', layout: 'vertical', paddingAll: '15px', backgroundColor: '#888888', contents: [{ type: 'text', text: '📝 今天已簽到', weight: 'bold', size: 'lg', color: '#FFFFFF', align: 'center' }] },
                            body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
                                { type: 'text', text: '嗨 ' + displayName + '！', weight: 'bold', size: 'lg', align: 'center' },
                                { type: 'text', text: '今天已經簽到過囉～', size: 'md', color: '#666666', align: 'center', margin: 'md' },
                                { type: 'separator', margin: 'lg' },
                                { type: 'box', layout: 'horizontal', margin: 'lg', contents: [{ type: 'text', text: '🔥 連續', size: 'sm', flex: 2 }, { type: 'text', text: gameData.streakDays + ' 天', size: 'sm', weight: 'bold', color: '#FF6B35', flex: 2, align: 'end' }] },
                                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '⭐ 總經驗', size: 'sm', flex: 2 }, { type: 'text', text: gameData.totalXP + ' XP', size: 'sm', weight: 'bold', flex: 2, align: 'end' }] },
                                { type: 'text', text: '明天記得再來喔！💪', size: 'sm', color: '#888888', align: 'center', margin: 'lg' }
                            ]}
                        }
                    }]
                });
            } else {
                const gameData = await gamificationService.getUserGameData(userId);
                let extraMessage = '';
                if (result.streakBonus) extraMessage = '\n\n🎊 連續 ' + result.streakBonus.days + ' 天獎勵：+' + result.streakBonus.xp + ' XP！';
                if (result.isNightShift) extraMessage += '\n🌙 夜貓子連續：' + result.nightStreak + ' 天';
                if (result.hiddenBadgeEarned) extraMessage += '\n\n🏅 解鎖隱藏徽章：' + result.hiddenBadgeEarned.name + '！';
                if (result.leveledUp) extraMessage += '\n\n🎉 恭喜升級到 Lv.' + result.newLevel + ' ' + result.levelName + '！';

                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'flex', altText: '✅ 簽到成功！連續 ' + result.streak + ' 天',
                        contents: {
                            type: 'bubble', size: 'mega',
                            header: { type: 'box', layout: 'vertical', paddingAll: '18px', backgroundColor: '#1DB446', contents: [
                                { type: 'text', text: '✅ 簽到成功！', weight: 'bold', size: 'xl', color: '#FFFFFF', align: 'center' },
                                { type: 'text', text: displayName, size: 'md', color: '#FFFFFF', align: 'center', margin: 'sm' }
                            ]},
                            body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
                                { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '🔥 連續簽到', size: 'md', flex: 3 }, { type: 'text', text: result.streak + ' 天', size: 'lg', weight: 'bold', color: '#FF6B35', flex: 2, align: 'end' }] },
                                { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: '⭐ 獲得經驗', size: 'md', flex: 3 }, { type: 'text', text: '+' + result.xpGained + ' XP', size: 'lg', weight: 'bold', color: '#9B59B6', flex: 2, align: 'end' }] },
                                { type: 'separator', margin: 'lg' },
                                { type: 'box', layout: 'horizontal', margin: 'lg', contents: [{ type: 'text', text: '等級', size: 'sm', color: '#888888', flex: 2 }, { type: 'text', text: 'Lv.' + gameData.level + ' ' + gameData.levelName, size: 'sm', weight: 'bold', flex: 3, align: 'end' }] },
                                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '累計經驗', size: 'sm', color: '#888888', flex: 2 }, { type: 'text', text: gameData.totalXP + ' XP', size: 'sm', flex: 3, align: 'end' }] },
                                extraMessage ? { type: 'text', text: extraMessage, size: 'sm', color: '#1DB446', wrap: true, margin: 'lg' } : null
                            ].filter(Boolean)},
                            footer: { type: 'box', layout: 'horizontal', paddingAll: '12px', spacing: 'sm', contents: [
                                { type: 'button', action: { type: 'message', label: '🎴 抽籤', text: '抽籤' }, style: 'primary', color: '#FF6B35', height: 'sm', flex: 1 },
                                { type: 'button', action: { type: 'message', label: '💪 我的成就', text: '我的成就' }, style: 'secondary', height: 'sm', flex: 1 }
                            ]}
                        }
                    }]
                });
            }
            return;
        }

        // 🎴 抽籤功能
        const fortuneKeywords = ['抽籤', '抽', '運勢', '籤', '幸運', '占卜', '今日運勢'];
        if (fortuneKeywords.some(keyword => text === keyword || (keyword.length > 1 && text.includes(keyword)))) {
            const userId = event.source.userId;
            const isGroup = event.source.type === 'group';
            if (!userId) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '😅 無法識別你的身份，請私訊我或加我為好友喔～' }] });
                return;
            }
            if (isGroup) {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'flex', altText: '🎴 私訊我抽籤吧！',
                        contents: {
                            type: 'bubble', size: 'kilo',
                            body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
                                { type: 'text', text: '🎴 馥能量抽籤', weight: 'bold', size: 'lg', align: 'center' },
                                { type: 'text', text: '私訊我吧～\n這是你和宇宙的私密對話 💚', size: 'sm', color: '#666666', align: 'center', wrap: true, margin: 'md' }
                            ]},
                            footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'button', action: { type: 'uri', label: '👉 點我私訊抽籤', uri: 'https://line.me/R/oaMessage/' + LINE_OA_ID + '/?抽' }, style: 'primary', color: '#FF6B35', height: 'sm' }] }
                        }
                    }]
                });
                return;
            }
            const card = await fortuneService.drawFortune(userId, 'manual');
            if (!card) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '😅 籤筒好像空了...請稍後再試～' }] });
                return;
            }
            await gamificationService.addXP(userId, 5, 'draw', '抽籤');
            await client.replyMessage({ replyToken: event.replyToken, messages: [fortuneService.createFortuneFlexMessage(card)] });
            return;
        }

        // 💪 我的成就
        const achievementKeywords = ['成就', '我的成就', '戰績', '我的狀態', '狀態'];
        if (achievementKeywords.some(keyword => text.includes(keyword))) {
            const userId = event.source.userId;
            if (!userId) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '😅 無法識別你的身份，請私訊我喔～' }] });
                return;
            }
            const gameData = await gamificationService.getUserGameData(userId);
            const statsMessage = gamificationService.createUserStatsFlexMessage(gameData);
            await client.replyMessage({ replyToken: event.replyToken, messages: [statsMessage] });
            return;
        }

        // 拍照辨識指令
        if (text.includes('拍照') || text.includes('辨識') || text.includes('掃描') || text.includes('ai') || text.includes('登記')) {
            const isGroup = event.source.type === 'group';
            if (isGroup) {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'flex', altText: '📸 私訊我拍照登記！',
                        contents: {
                            type: 'bubble', size: 'kilo',
                            body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
                                { type: 'text', text: '📸 拍照登記商品', weight: 'bold', size: 'lg', align: 'center' },
                                { type: 'text', text: '私訊我傳照片～\n這樣群組比較乾淨喔！', size: 'sm', color: '#666666', align: 'center', wrap: true, margin: 'md' }
                            ]},
                            footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'button', action: { type: 'uri', label: '👉 點我私訊拍照', uri: 'https://line.me/R/oaMessage/' + LINE_OA_ID + '/?拍照' }, style: 'primary', color: '#1DB446', height: 'sm' }] }
                        }
                    }]
                });
                return;
            }
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '📸 好的！請直接拍一張商品照片給我～\n\n💡 拍照小秘訣：\n► 把條碼、商品名、效期都拍進去\n► 光線要充足喔\n► 拍清楚一點，辨識更準確！\n\n拍好直接傳給我就可以囉～ 🙌' }] });
            return;
        }

        // 時段問候
        if (text.includes('早安')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '早安！☀️ 新的一天開始囉～\n\n別忘了檢查一下今天有沒有商品要到期喔！\n輸入「今天」可以快速查詢 📋' }] }); return; }
        if (text.includes('午安')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '午安！🌤️ 吃飽了嗎？\n\n下午繼續加油！記得補充水分喔～ 💧' }] }); return; }
        if (text.includes('晚安')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '晚安！🌙 今天辛苦了～\n\n明天見囉，好好休息！😴' }] }); return; }

        // 效期查詢
        if (text.includes('效期') || text.includes('到期') || text.includes('過期')) {
            const expiringResult = await db.query("SELECT COUNT(*) as count FROM inventory WHERE status = 'in_stock' AND expiry_date <= NOW() + INTERVAL '24 hours' AND expiry_date > NOW()");
            const totalResult = await db.query("SELECT COUNT(*) as count FROM inventory WHERE status = 'in_stock'");
            const expiredResult = await db.query("SELECT COUNT(*) as count FROM inventory WHERE status = 'in_stock' AND expiry_date <= NOW()");
            await client.replyMessage({ replyToken: event.replyToken, messages: [createExpiryReportFlex(parseInt(totalResult.rows[0].count), parseInt(expiringResult.rows[0].count), parseInt(expiredResult.rows[0].count), baseUrl)] });
            return;
        }

        // 今天到期
        if (text.includes('今天') || text.includes('今日')) {
            const todayResult = await db.query("SELECT p.name, i.expiry_date, i.quantity, p.storage_temp FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.status = 'in_stock' AND DATE(i.expiry_date) = CURRENT_DATE ORDER BY i.expiry_date ASC LIMIT 10");
            const todayItems = todayResult.rows;
            if (todayItems.length === 0) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '🎉 耶！今天沒有商品要到期～\n\n你超棒的，繼續保持喔！✨' }] });
            } else {
                const itemList = todayItems.map((item, i) => '  ' + (i+1) + '. ' + item.name + '（' + item.quantity + '個）').join('\n');
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '📢 今天有 ' + todayItems.length + ' 個商品要到期囉～\n\n' + itemList + '\n\n記得去處理一下喔！💪\n' + baseUrl + '/inventory' }] });
            }
            return;
        }

        // 明天到期
        if (text.includes('明天') || text.includes('明日')) {
            const tomorrowResult = await db.query("SELECT p.name, i.expiry_date, i.quantity, p.storage_temp FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.status = 'in_stock' AND DATE(i.expiry_date) = CURRENT_DATE + INTERVAL '1 day' ORDER BY i.expiry_date ASC LIMIT 10");
            const tomorrowItems = tomorrowResult.rows;
            if (tomorrowItems.length === 0) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '✨ 明天沒有商品要到期喔～\n\n但還是去巡一下貨架比較安心啦！😊' }] });
            } else {
                const itemList = tomorrowItems.map((item, i) => '  ' + (i+1) + '. ' + item.name + '（' + item.quantity + '個）').join('\n');
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '💡 明天有 ' + tomorrowItems.length + ' 個商品要到期：\n\n' + itemList + '\n\n先記下來，明天別忘了處理喔～ 📝' }] });
            }
            return;
        }

        // 庫存查詢
        if (text.includes('庫存') || text.includes('有什麼') || text.includes('多少')) {
            const totalItemsResult = await db.query("SELECT COUNT(*) as count FROM inventory WHERE status = 'in_stock'");
            const totalProductsResult = await db.query("SELECT COUNT(*) as count FROM products");
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'flex', altText: '庫存狀況',
                    contents: {
                        type: 'bubble', size: 'kilo',
                        body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
                            { type: 'text', text: '📦 庫存狀況', weight: 'bold', size: 'lg', color: '#F7941D' },
                            { type: 'separator', margin: 'md' },
                            { type: 'box', layout: 'horizontal', margin: 'lg', contents: [{ type: 'text', text: '在庫商品', size: 'sm', color: '#666666' }, { type: 'text', text: totalItemsResult.rows[0].count + ' 件', size: 'sm', weight: 'bold', align: 'end' }] },
                            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '商品資料庫', size: 'sm', color: '#666666' }, { type: 'text', text: totalProductsResult.rows[0].count + ' 種', size: 'sm', weight: 'bold', align: 'end' }] }
                        ]},
                        footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'button', action: { type: 'uri', label: '👉 查看庫存', uri: baseUrl + '/inventory' }, style: 'primary', color: '#1DB446', height: 'sm' }] }
                    }
                }]
            });
            return;
        }

        // 溫層查詢
        if (text.includes('冷藏')) { await replyTempQuery(client, event.replyToken, 'refrigerated', '❄️ 冷藏', baseUrl); return; }
        if (text.includes('冷凍')) { await replyTempQuery(client, event.replyToken, 'frozen', '🧊 冷凍', baseUrl); return; }
        if (text.includes('常溫')) { await replyTempQuery(client, event.replyToken, 'room_temp', '🌡️ 常溫', baseUrl); return; }

        // 統計報表
        if (text.includes('報表') || text.includes('統計')) {
            const weekStatsResult = await db.query("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold, SUM(CASE WHEN status = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) as in_stock FROM inventory WHERE created_at >= NOW() - INTERVAL '7 days'");
            const weekStats = weekStatsResult.rows[0];
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'flex', altText: '本週統計報表',
                    contents: {
                        type: 'bubble', size: 'kilo',
                        header: { type: 'box', layout: 'vertical', paddingAll: '15px', backgroundColor: '#F7941D', contents: [{ type: 'text', text: '📊 本週統計報表', weight: 'bold', size: 'lg', color: '#FFFFFF' }] },
                        body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: [
                            { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '📥 登記', size: 'sm', color: '#666666' }, { type: 'text', text: (weekStats.total || 0) + ' 件', size: 'sm', weight: 'bold', align: 'end' }] },
                            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '✅ 售出', size: 'sm', color: '#666666' }, { type: 'text', text: (weekStats.sold || 0) + ' 件', size: 'sm', weight: 'bold', align: 'end', color: '#1DB446' }] },
                            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '🗑️ 報廢', size: 'sm', color: '#666666' }, { type: 'text', text: (weekStats.removed || 0) + ' 件', size: 'sm', weight: 'bold', align: 'end', color: '#FF5551' }] },
                            { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '📦 在庫', size: 'sm', color: '#666666' }, { type: 'text', text: (weekStats.in_stock || 0) + ' 件', size: 'sm', weight: 'bold', align: 'end' }] }
                        ]}
                    }
                }]
            });
            return;
        }

        // 最近登記
        if (text.includes('最近') || text.includes('剛剛') || text.includes('剛才')) {
            const recentItemsResult = await db.query("SELECT p.name, i.quantity, i.created_at FROM inventory i JOIN products p ON i.product_id = p.id ORDER BY i.created_at DESC LIMIT 5");
            const recentItems = recentItemsResult.rows;
            if (recentItems.length === 0) {
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '還沒有登記任何商品喔～\n\n👉 快去登記：\n' + baseUrl + '/smart-register' }] });
            } else {
                const itemList = recentItems.map((item, i) => (i+1) + '. ' + item.name + '（' + item.quantity + '個）').join('\n');
                await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '📝 最近登記的商品：\n\n' + itemList }] });
            }
            return;
        }

        // 教學
        if (text.includes('教學') || text.includes('怎麼用') || text.includes('教我')) {
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '📚 潮欣小幫手使用教學\n\n【🎮 遊戲化功能】\n• 簽到/打卡 → 每日簽到獲得 XP\n• 抽/抽籤 → 抽幸運籤\n• 成就 → 查看你的戰績\n\n【登記商品】\n1. 打開網頁 → 快速商品登記\n2. 輸入條碼（或掃描）\n3. 填寫商品資訊、選效期\n4. 確認登記，完成！\n\n【查看庫存】\n打開網頁 → 庫存管理\n可以看到所有商品和效期\n\n【LINE 指令】\n• 效期 → 查效期狀況\n• 今天 → 今天到期的\n• 庫存 → 查庫存數量\n• 報表 → 本週統計\n\n👉 ' + baseUrl }] });
            return;
        }

        // 感謝回應
        if (text.includes('謝謝') || text.includes('感謝') || text.includes('3q') || text.includes('thank')) {
            const responses = ['不客氣！有需要隨時叫我～ 😊', '不會不會～這是我應該做的！💪', '能幫上忙太好了！🧡', '客氣啦～繼續加油喔！✨', '嘿嘿，小事一樁！😄'];
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: responses[Math.floor(Math.random() * responses.length)] }] });
            return;
        }

        // 鼓勵回應
        if (text.includes('辛苦') || text.includes('累') || text.includes('煩')) {
            const responses = ['辛苦了！你真的很棒 💪\n休息一下，喝杯水吧～ 🥤', '加油加油！你已經做得很好了 ✨', '累了就休息一下，我會幫你盯著效期的！😊', '深呼吸～一切都會沒事的 🧡', '你很努力了！給自己一個擁抱吧～ 🤗'];
            await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: responses[Math.floor(Math.random() * responses.length)] }] });
            return;
        }

        // 加油回應
        if (text.includes('加油')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '你也加油！我們一起努力 💪✨\n有我在，效期管理交給我！' }] }); return; }

        // ========== 員工認領功能 ==========
        if (text.includes('認領') || text.includes('綁定') || text === '我是誰') {
            try {
                // 檢查是否已經綁定
                const boundResult = await db.query(
                    'SELECT * FROM employees WHERE line_user_id = $1 AND is_active = true', 
                    [userId]
                );
                
                if (boundResult.rows.length > 0) {
                    const emp = boundResult.rows[0];
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ 
                            type: 'text', 
                            text: `✅ 你已經綁定為「${emp.name}」囉！\n\n輸入「班表」查看你的排班～` 
                        }] 
                    });
                    return;
                }

                // 取得未綁定的員工列表
                const empListResult = await db.query(
                    'SELECT id, name FROM employees WHERE (line_user_id IS NULL OR line_user_id = \'\') AND is_active = true ORDER BY name'
                );
                
                if (empListResult.rows.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ 
                            type: 'text', 
                            text: '😅 目前沒有可認領的員工名單喔～\n\n請聯絡店長先建立員工資料！' 
                        }] 
                    });
                    return;
                }

                // 建立選擇按鈕
                const buttons = empListResult.rows.slice(0, 10).map(emp => ({
                    type: 'button',
                    style: 'primary',
                    color: '#FF6B35',
                    height: 'sm',
                    margin: 'sm',
                    action: {
                        type: 'postback',
                        label: emp.name,
                        data: `action=claim_employee&id=${emp.id}&name=${encodeURIComponent(emp.name)}`,
                        displayText: `我是 ${emp.name}`
                    }
                }));

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{
                        type: 'flex',
                        altText: '請選擇你是誰',
                        contents: {
                            type: 'bubble',
                            size: 'kilo',
                            header: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#FF6B35',
                                paddingAll: '15px',
                                contents: [
                                    { type: 'text', text: '👋 請選擇你是誰', weight: 'bold', size: 'lg', color: '#FFFFFF', align: 'center' }
                                ]
                            },
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                paddingAll: '15px',
                                spacing: 'sm',
                                contents: [
                                    { type: 'text', text: '點選你的名字完成綁定：', size: 'sm', color: '#666666', align: 'center', margin: 'md' },
                                    ...buttons
                                ]
                            }
                        }
                    }]
                });
            } catch (error) {
                console.error('認領功能錯誤:', error);
                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: '認領功能暫時有問題，請稍後再試～' }] 
                });
            }
            return;
        }

        // 班表查詢
        if (text.includes('班表') || text.includes('排班') || text.includes('上班')) {
            try {
                // 查找員工
                const empResult = await db.query('SELECT * FROM employees WHERE line_user_id = $1 AND is_active = true', [userId]);
                
                if (empResult.rows.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ type: 'text', text: '📅 你還沒有綁定員工帳號喔～\n\n👉 私訊我輸入「認領」來綁定你的名字！' }] 
                    });
                    return;
                }

                const employee = empResult.rows[0];
                
                // 取得未來 7 天班表
                const scheduleResult = await db.query(`
                    SELECT s.*, st.name as shift_name, st.start_time, st.end_time
                    FROM schedules s
                    LEFT JOIN shift_types st ON s.shift_type = st.code
                    WHERE s.employee_id = $1 
                    AND s.work_date >= CURRENT_DATE
                    AND s.work_date < CURRENT_DATE + INTERVAL '7 days'
                    ORDER BY s.work_date
                `, [employee.id]);

                const schedules = scheduleResult.rows;
                const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

                if (schedules.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ type: 'text', text: '📅 ' + employee.name + ' 的班表\n\n未來 7 天還沒有排班資料喔～\n請聯絡店長確認！' }] 
                    });
                    return;
                }

                // 組織班表訊息
                let scheduleText = '📅 ' + employee.name + ' 的班表\n\n';
                schedules.forEach(s => {
                    const date = new Date(s.work_date);
                    const dayName = weekDays[date.getDay()];
                    const dateStr = (date.getMonth() + 1) + '/' + date.getDate();
                    
                    if (s.shift_type === 'off') {
                        scheduleText += `${dateStr}(${dayName}) 🏖️ 休假\n`;
                    } else {
                        const timeStr = s.start_time?.substring(0,5) + '-' + s.end_time?.substring(0,5);
                        scheduleText += `${dateStr}(${dayName}) ${s.shift_name} ${timeStr}\n`;
                    }
                });

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: scheduleText }] 
                });
            } catch (error) {
                console.error('班表查詢錯誤:', error);
                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: '班表查詢暫時有問題，請稍後再試～' }] 
                });
            }
            return;
        }

        // 今天誰上班
        if (text.includes('今天') && (text.includes('誰') || text.includes('上班') || text.includes('夥伴'))) {
            try {
                const todayResult = await db.query(`
                    SELECT e.name, s.shift_type, st.name as shift_name, st.start_time, st.end_time
                    FROM schedules s
                    JOIN employees e ON s.employee_id = e.id
                    LEFT JOIN shift_types st ON s.shift_type = st.code
                    WHERE s.work_date = CURRENT_DATE
                    AND e.is_active = true
                    AND s.shift_type != 'off'
                    ORDER BY st.sort_order, e.name
                `);

                if (todayResult.rows.length === 0) {
                    await client.replyMessage({ 
                        replyToken: event.replyToken, 
                        messages: [{ type: 'text', text: '📅 今天的班表\n\n還沒有排班資料喔～' }] 
                    });
                    return;
                }

                let todayText = '📅 今天的班表\n\n';
                const grouped = {};
                todayResult.rows.forEach(r => {
                    if (!grouped[r.shift_type]) grouped[r.shift_type] = { name: r.shift_name, time: r.start_time?.substring(0,5) + '-' + r.end_time?.substring(0,5), people: [] };
                    grouped[r.shift_type].people.push(r.name);
                });

                Object.values(grouped).forEach(g => {
                    todayText += `${g.name} ${g.time}\n`;
                    todayText += `👥 ${g.people.join('、')}\n\n`;
                });

                await client.replyMessage({ 
                    replyToken: event.replyToken, 
                    messages: [{ type: 'text', text: todayText.trim() }] 
                });
            } catch (error) {
                console.error('今天班表查詢錯誤:', error);
            }
            return;
        }

        // 隱藏彩蛋
        if (text.includes('我愛你') || text.includes('愛你')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '啊...突然告白好害羞 😳\n我...我也很喜歡幫你管理效期啦！💕' }] }); return; }
        if (text.includes('笨蛋') || text.includes('白痴')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '嗚嗚...人家只是個小幫手啦 😢\n不要罵我，我會更努力的！' }] }); return; }
        if (text.includes('好可愛') || text.includes('可愛')) { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '欸嘿嘿～謝謝誇獎！😆\n你也很可愛喔！（？' }] }); return; }
        if (text === '666' || text === '厲害' || text === '讚') { await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '666！🎉\n你更厲害！繼續保持～ ✨' }] }); return; }

        return null;
    }

    async function replyTempQuery(client, replyToken, tempValue, tempName, baseUrl) {
        const itemsResult = await db.query("SELECT COUNT(*) as count FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.status = 'in_stock' AND p.storage_temp = $1", [tempValue]);
        await client.replyMessage({ replyToken: replyToken, messages: [{ type: 'text', text: tempName + ' 商品目前有 ' + itemsResult.rows[0].count + ' 件在庫喔！\n\n👉 查看詳情：\n' + baseUrl + '/inventory' }] });
    }

    function createExpiryReportFlex(total, expiring, expired, baseUrl) {
        return {
            type: 'flex', altText: '效期狀況報告',
            contents: {
                type: 'bubble', size: 'kilo',
                header: { type: 'box', layout: 'vertical', paddingAll: '15px', backgroundColor: '#FFF8F0', contents: [{ type: 'text', text: '📊 效期狀況報告', weight: 'bold', size: 'lg', color: '#F7941D' }] },
                body: { type: 'box', layout: 'vertical', paddingAll: '15px', contents: [
                    { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '總庫存', size: 'sm', color: '#666666', flex: 2 }, { type: 'text', text: total + ' 件', size: 'sm', weight: 'bold', flex: 2 }] },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: '即將到期', size: 'sm', color: '#666666', flex: 2 }, { type: 'text', text: expiring + ' 件', size: 'sm', weight: 'bold', color: expiring > 0 ? '#FF9800' : '#1DB446', flex: 2 }] },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: '已過期', size: 'sm', color: '#666666', flex: 2 }, { type: 'text', text: expired + ' 件', size: 'sm', weight: 'bold', color: expired > 0 ? '#FF5551' : '#1DB446', flex: 2 }] }
                ]},
                footer: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [{ type: 'button', action: { type: 'uri', label: '👉 查看詳情', uri: baseUrl + '/inventory' }, style: 'primary', color: '#1DB446', height: 'sm' }] }
            }
        };
    }

    function createMenuFlexMessage(baseUrl) {
        return {
            type: 'flex', altText: '潮欣小幫手選單',
            contents: {
                type: 'bubble', size: 'mega',
                header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#F7941D', contents: [
                    { type: 'text', text: '🏪 潮欣小幫手 2.0', weight: 'bold', size: 'xl', color: '#FFFFFF' },
                    { type: 'text', text: '便利商店效期管理 × 遊戲化', size: 'sm', color: '#FFFFFF', margin: 'sm' }
                ]},
                body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
                    { type: 'text', text: '嗨～我是潮欣小幫手！', size: 'md', wrap: true },
                    { type: 'text', text: '有什麼需要幫忙的嗎？', size: 'sm', color: '#666666', margin: 'sm' },
                    { type: 'separator', margin: 'lg' },
                    { type: 'text', text: '🎮 每日任務', size: 'sm', color: '#FF6B35', weight: 'bold', margin: 'lg' },
                    { type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm', contents: [
                        { type: 'button', action: { type: 'message', label: '📝 簽到', text: '簽到' }, style: 'primary', color: '#1DB446', height: 'sm', flex: 1 },
                        { type: 'button', action: { type: 'message', label: '🎴 抽籤', text: '抽籤' }, style: 'primary', color: '#9B59B6', height: 'sm', flex: 1 },
                        { type: 'button', action: { type: 'message', label: '💪 成就', text: '我的成就' }, style: 'secondary', height: 'sm', flex: 1 }
                    ]},
                    { type: 'text', text: '📋 查詢功能', size: 'sm', color: '#1DB446', weight: 'bold', margin: 'lg' },
                    { type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm', contents: [
                        { type: 'button', action: { type: 'message', label: '📊 總覽', text: '總覽' }, style: 'primary', color: '#FF6B35', height: 'sm', flex: 1 },
                        { type: 'button', action: { type: 'message', label: '⏰ 效期', text: '效期' }, style: 'secondary', height: 'sm', flex: 1 },
                        { type: 'button', action: { type: 'message', label: '📦 庫存', text: '庫存' }, style: 'secondary', height: 'sm', flex: 1 }
                    ]},
                    { type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'sm', contents: [
                        { type: 'button', action: { type: 'message', label: '📅 班表', text: '班表' }, style: 'secondary', height: 'sm', flex: 1 },
                        { type: 'button', action: { type: 'message', label: '📢 公告', text: '公告' }, style: 'secondary', height: 'sm', flex: 1 },
                        { type: 'button', action: { type: 'message', label: '👋 認領', text: '認領' }, style: 'secondary', height: 'sm', flex: 1 }
                    ]}
                ]},
                footer: { type: 'box', layout: 'vertical', paddingAll: '15px', spacing: 'sm', contents: [
                    { type: 'button', action: { type: 'uri', label: '🏠 前往網頁', uri: baseUrl }, style: 'primary', color: '#F7941D', height: 'sm' },
                    { type: 'box', layout: 'vertical', margin: 'md', contents: [{ type: 'text', text: '💡 直接輸入關鍵字就能查詢喔！', size: 'xs', color: '#999999', align: 'center', wrap: true }] }
                ]}
            }
        };
    }

    async function sendExpiryAlert(items, baseUrl) {
        const client = await getClient();
        let groupId = process.env.LINE_GROUP_ID;
        const settings = await getLineSettings();
        if (settings && settings.group_id) groupId = settings.group_id;
        if (!client || !groupId) { console.log('LINE Bot 未設定或沒有群組 ID'); return { success: false, error: 'LINE Bot 未設定' }; }
        if (items.length === 0) return { success: true, message: '沒有即將到期的商品' };

        const messages = [{ type: 'text', text: '📢 叮咚～效期小提醒！\n\n有 ' + items.length + ' 個商品快到期囉，記得去處理一下 💪' }];
        const bubbles = items.slice(0, 10).map(item => createProductBubble(item, baseUrl));
        bubbles.push({
            type: 'bubble', size: 'kilo',
            body: { type: 'box', layout: 'vertical', paddingAll: '15px', contents: [{ type: 'text', text: '👉 前往網頁處理', weight: 'bold', size: 'md', align: 'center', color: '#1DB446' }], action: { type: 'uri', label: '前往網頁', uri: (baseUrl || 'https://chaoxin-helper.onrender.com') + '/inventory' } }
        });
        messages.push({ type: 'flex', altText: '效期提醒：' + items.length + ' 個商品即將到期', contents: { type: 'carousel', contents: bubbles } });

        try {
            await client.pushMessage({ to: groupId, messages: messages });
            return { success: true, message: '已發送提醒，共 ' + items.length + ' 個商品' };
        } catch (error) {
            console.error('發送 LINE 訊息失敗:', error);
            return { success: false, error: error.message };
        }
    }

    function createProductBubble(item, baseUrl) {
        const expiryDate = new Date(item.expiry_date);
        const diffHours = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60));
        const tempIcons = { 'refrigerated': '❄️ 冷藏', 'frozen': '🧊 冷凍', 'room_temp': '🌡️ 常溫' };
        const tempText = tempIcons[item.storage_temp] || '❄️ 冷藏';
        let urgencyColor = '#1DB446', urgencyText = '還有 ' + diffHours + ' 小時';
        if (diffHours <= 0) { urgencyColor = '#FF5551'; urgencyText = '⚠️ 已過期！'; }
        else if (diffHours <= 6) { urgencyColor = '#FF5551'; urgencyText = '⚠️ 僅剩 ' + diffHours + ' 小時！'; }
        else if (diffHours <= 12) { urgencyColor = '#FF9800'; urgencyText = '還有 ' + diffHours + ' 小時'; }

        return {
            type: 'bubble', size: 'kilo',
            header: { type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#F7F7F7', contents: [{ type: 'text', text: item.name, weight: 'bold', size: 'md', wrap: true, maxLines: 2 }] },
            body: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', contents: [
                { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '效期', size: 'sm', color: '#999999', flex: 2 }, { type: 'text', text: expiryDate.toLocaleDateString('zh-TW'), size: 'sm', flex: 3 }] },
                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '倒數', size: 'sm', color: '#999999', flex: 2 }, { type: 'text', text: urgencyText, size: 'sm', color: urgencyColor, weight: 'bold', flex: 3 }] },
                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '溫層', size: 'sm', color: '#999999', flex: 2 }, { type: 'text', text: tempText, size: 'sm', flex: 3 }] },
                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '數量', size: 'sm', color: '#999999', flex: 2 }, { type: 'text', text: item.quantity + ' 個', size: 'sm', flex: 3 }] }
            ]},
            footer: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', contents: [
                { type: 'button', action: { type: 'postback', label: '🔍 找不到（已售出）', data: 'action=sold&id=' + item.id, displayText: '「' + item.name + '」找不到了，應該已售出 ✨' }, style: 'secondary', height: 'sm' },
                { type: 'button', action: { type: 'postback', label: '📦 找到了（已下架）', data: 'action=remove&id=' + item.id, displayText: '「' + item.name + '」已從架上移除' }, style: 'primary', color: '#FF5551', height: 'sm' }
            ]}
        };
    }

    return { handleEvent, sendExpiryAlert, getClient, getLineSettings };
};
