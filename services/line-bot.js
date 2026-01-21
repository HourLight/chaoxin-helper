/**
 * LINE Bot 服務
 * 處理 LINE 訊息和互動
 * 潮欣小幫手 v1.0.0
 */

const line = require('@line/bot-sdk');
const aiRecognition = require('./ai-recognition');  // ← 加這行

module.exports = function(db) {
    /**
     * 取得 LINE 設定
     */
    function getLineSettings() {
        const settings = db.prepare(`
            SELECT * FROM line_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1
        `).get();
        return settings;
    }

    /**
     * 取得 LINE Client
     */
    function getClient() {
        const settings = getLineSettings();
        if (!settings || !settings.channel_access_token) {
            // 嘗試從環境變數取得
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
    const client = getClient();
    if (!client) return null;

    // 處理 Postback 事件（互動按鈕點擊）
    if (event.type === 'postback') {
        return handlePostback(event, client);
    }

    // 處理圖片訊息（AI 辨識）
    if (event.type === 'message' && event.message.type === 'image') {
        return handleImageMessage(event, client);
    }

    // 處理文字訊息
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

        if (action === 'remove' && inventoryId) {
            // 標記商品為已下架
            const stmt = db.prepare(`
                UPDATE inventory 
                SET status = 'removed', updated_at = datetime('now')
                WHERE id = ?
            `);
            stmt.run(inventoryId);

            // 取得商品資訊
            const item = db.prepare(`
                SELECT p.name FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.id = ?
            `).get(inventoryId);

            const productName = item ? item.name : '商品';

// 回覆確認訊息
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `✅ 已標記「${productName}」為「已下架」，不會再收到提醒囉！\n\n辛苦了～繼續加油 💪`
                }]
            });
        }

        return null;
    }

    /**
     * 處理圖片訊息 - AI 辨識
     */
    async function handleImageMessage(event, client) {
        const messageId = event.message.id;
        const baseUrl = process.env.BASE_URL || 'https://chaoxin-helper.onrender.com';

        try {
            // 先回覆處理中
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: '📸 收到照片！正在辨識中...\n請稍等一下喔～ ⏳'
                }]
            });

            // 進行 AI 辨識
            const result = await aiRecognition.recognizeFromLineImage(messageId);

            // 組織回覆訊息
            let message = '✨ 辨識結果：\n\n';
            const params = new URLSearchParams();

            // 條碼
            if (result.barcode && result.barcode.value) {
                const conf = aiRecognition.getConfidenceLevel(result.barcode.confidence);
                message += `📦 條碼：${result.barcode.value} ${conf.icon}\n`;
                params.append('barcode', result.barcode.value);
            }

            // 商品名稱
            if (result.name && result.name.value) {
                const conf = aiRecognition.getConfidenceLevel(result.name.confidence);
                message += `🏷️ 商品：${result.name.value} ${conf.icon}\n`;
                params.append('name', result.name.value);
            }

            // 效期
            if (result.expiry_date && result.expiry_date.value) {
                const conf = aiRecognition.getConfidenceLevel(result.expiry_date.confidence);
                const displayDate = new Date(result.expiry_date.value).toLocaleDateString('zh-TW');
                message += `📅 效期：${displayDate} ${conf.icon}\n`;
                if (result.expiry_date.original_text) {
                    message += `   （原始：${result.expiry_date.original_text}）\n`;
                }
                params.append('expiry', result.expiry_date.value);
            }

            // 溫層
            if (result.storage_temp) {
                const tempMap = {
                    'refrigerated': '❄️ 冷藏',
                    'frozen': '🧊 冷凍',
                    'room_temp': '🌡️ 常溫'
                };
                message += `🌡️ 溫層：${tempMap[result.storage_temp] || '冷藏'}\n`;
                params.append('temp', result.storage_temp);
            }

            // 分類
            if (result.category) {
                message += `📁 分類：${result.category}\n`;
                params.append('category', result.category);
            }

            // 備註
            if (result.notes) {
                message += `\n💡 備註：${result.notes}\n`;
            }

            // 模擬模式提示
            if (result.mock) {
                message += '\n⚠️ 目前為模擬模式，請到網頁手動登記';
            }

            // 有辨識到資料，提供快速登記連結
            if (params.toString()) {
                message += '\n━━━━━━━━━━\n';
                message += '\n👆 確認資訊正確後\n';
                message += '👉 點這裡完成登記：\n';
                message += `${baseUrl}/smart-register?${params.toString()}`;
            } else {
                message += '\n😅 沒有辨識到完整資訊\n';
                message += '請到網頁手動登記：\n';
                message += `${baseUrl}/smart-register`;
            }

            // 發送辨識結果（用 pushMessage 因為已經用掉 replyToken）
            const targetId = event.source.groupId || event.source.userId;
            await client.pushMessage({
                to: targetId,
                messages: [{ type: 'text', text: message }]
            });

        } catch (error) {
            console.error('圖片辨識失敗:', error);
            
            const targetId = event.source.groupId || event.source.userId;
            await client.pushMessage({
                to: targetId,
                messages: [{
                    type: 'text',
                    text: `😅 辨識失敗了...\n\n錯誤：${error.message}\n\n請到網頁手動登記：\n${baseUrl}/pages/smart-register.html`
                }]
            });
        }

        return null;
    }
       
    /**
     * 處理文字訊息
     */
    async function handleTextMessage(event, client) {
        const text = event.message.text.toLowerCase();
        const originalText = event.message.text;
        const baseUrl = process.env.BASE_URL || 'https://chaoxin-helper.onrender.com';

        // ===== 主選單關鍵字 =====
        const menuKeywords = [
            '潮欣小幫手', '小幫手', '店長助理', '小助理', 
            '小妞', '潮欣小妞', '幫助', 'help', '選單', 'menu',
            '功能', '可以做什麼', '有什麼功能'
        ];

        if (menuKeywords.some(keyword => text.includes(keyword))) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [createMenuFlexMessage(baseUrl)]
            });
            return;
        }

        // ===== 打招呼 =====
        const greetings = ['你好', '嗨', 'hi', 'hello', '哈囉', '安安', '在嗎'];
        if (greetings.some(g => text.includes(g))) {
            const hour = new Date().getHours();
            let timeGreeting = '你好';
            if (hour >= 5 && hour < 12) timeGreeting = '早安';
            else if (hour >= 12 && hour < 18) timeGreeting = '午安';
            else timeGreeting = '晚安';

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `${timeGreeting}～我是潮欣小幫手！🏪\n\n有什麼需要幫忙的嗎？\n輸入「選單」可以看到所有功能喔～`
                }]
            });
            return;
        }
// ===== 拍照辨識指令 =====
        if (text.includes('拍照') || text.includes('辨識') || text.includes('掃描') || text.includes('ai')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `📸 好的！請直接拍一張商品照片給我～\n\n💡 拍照小秘訣：\n► 把條碼、商品名、效期都拍進去\n► 光線要充足喔\n► 拍清楚一點，辨識更準確！\n\n拍好直接傳給我就可以囉～ 🙌`
                }]
            });
            return;
        }
        // ===== 時段問候 =====
        if (text.includes('早安')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `早安！☀️ 新的一天開始囉～\n\n別忘了檢查一下今天有沒有商品要到期喔！\n輸入「今天」可以快速查詢 📋`
                }]
            });
            return;
        }

        if (text.includes('午安')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `午安！🌤️ 吃飽了嗎？\n\n下午繼續加油！記得補充水分喔～ 💧`
                }]
            });
            return;
        }

        if (text.includes('晚安')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `晚安！🌙 今天辛苦了～\n\n明天見囉，好好休息！😴`
                }]
            });
            return;
        }

        // ===== 效期查詢 =====
        if (text.includes('效期') || text.includes('到期') || text.includes('過期')) {
            const expiringItems = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' 
                AND expiry_date <= datetime('now', '+24 hours')
            `).get();

            const totalItems = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock'
            `).get();

            const expiredItems = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' 
                AND expiry_date <= datetime('now')
            `).get();

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [createExpiryReportFlex(totalItems.count, expiringItems.count, expiredItems.count, baseUrl)]
            });
            return;
        }

        // ===== 今天到期 =====
        if (text.includes('今天') || text.includes('今日')) {
            const todayItems = db.prepare(`
                SELECT p.name, i.expiry_date, i.quantity, p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = 'in_stock' 
                AND date(i.expiry_date) = date('now')
                ORDER BY i.expiry_date ASC
                LIMIT 10
            `).all();

            if (todayItems.length === 0) {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'text',
                        text: `✨ 太棒了！今天沒有商品到期喔～\n\n繼續保持！💪`
                    }]
                });
            } else {
                let itemList = todayItems.map((item, i) => 
                    `${i+1}. ${item.name}（${item.quantity}個）`
                ).join('\n');

                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{
                        type: 'text',
                        text: `⚠️ 今天有 ${todayItems.length} 個商品到期：\n\n${itemList}\n\n👉 前往處理：\n${baseUrl}/inventory`
                    }]
                });
            }
            return;
        }

        // ===== 庫存查詢 =====
        if (text.includes('庫存') || text.includes('有什麼') || text.includes('多少')) {
            const totalItems = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock'
            `).get();

            const totalProducts = db.prepare(`
                SELECT COUNT(*) as count FROM products
            `).get();

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'flex',
                    altText: '庫存狀況',
                    contents: {
                        type: 'bubble',
                        size: 'kilo',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: '📦 庫存狀況', weight: 'bold', size: 'lg', color: '#F7941D' },
                                { type: 'separator', margin: 'md' },
                                {
                                    type: 'box', layout: 'horizontal', margin: 'lg',
                                    contents: [
                                        { type: 'text', text: '在庫商品', size: 'sm', color: '#666666' },
                                        { type: 'text', text: `${totalItems.count} 件`, size: 'sm', weight: 'bold', align: 'end' }
                                    ]
                                },
                                {
                                    type: 'box', layout: 'horizontal', margin: 'sm',
                                    contents: [
                                        { type: 'text', text: '商品資料庫', size: 'sm', color: '#666666' },
                                        { type: 'text', text: `${totalProducts.count} 種`, size: 'sm', weight: 'bold', align: 'end' }
                                    ]
                                }
                            ],
                            paddingAll: '20px'
                        },
                        footer: {
                            type: 'box', layout: 'vertical', paddingAll: '12px',
                            contents: [{
                                type: 'button',
                                action: { type: 'uri', label: '👉 查看庫存', uri: `${baseUrl}/inventory` },
                                style: 'primary', color: '#1DB446', height: 'sm'
                            }]
                        }
                    }
                }]
            });
            return;
        }

        // ===== 溫層查詢 =====
        if (text.includes('冷藏')) {
            await replyTempQuery(client, event.replyToken, 'refrigerated', '❄️ 冷藏', baseUrl);
            return;
        }
        if (text.includes('冷凍')) {
            await replyTempQuery(client, event.replyToken, 'frozen', '🧊 冷凍', baseUrl);
            return;
        }
        if (text.includes('常溫')) {
            await replyTempQuery(client, event.replyToken, 'room_temp', '🌡️ 常溫', baseUrl);
            return;
        }

        // ===== 統計報表 =====
        if (text.includes('報表') || text.includes('統計')) {
            const weekStats = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN status = 'removed' THEN 1 ELSE 0 END) as removed,
                    SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) as in_stock
                FROM inventory 
                WHERE created_at >= datetime('now', '-7 days')
            `).get();

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'flex',
                    altText: '本週統計報表',
                    contents: {
                        type: 'bubble',
                        size: 'kilo',
                        header: {
                            type: 'box', layout: 'vertical', paddingAll: '15px', backgroundColor: '#F7941D',
                            contents: [{ type: 'text', text: '📊 本週統計報表', weight: 'bold', size: 'lg', color: '#FFFFFF' }]
                        },
                        body: {
                            type: 'box', layout: 'vertical', paddingAll: '20px',
                            contents: [
                                { type: 'box', layout: 'horizontal', contents: [
                                    { type: 'text', text: '📥 登記', size: 'sm', color: '#666666' },
                                    { type: 'text', text: `${weekStats.total || 0} 件`, size: 'sm', weight: 'bold', align: 'end' }
                                ]},
                                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                                    { type: 'text', text: '✅ 售出', size: 'sm', color: '#666666' },
                                    { type: 'text', text: `${weekStats.sold || 0} 件`, size: 'sm', weight: 'bold', align: 'end', color: '#1DB446' }
                                ]},
                                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                                    { type: 'text', text: '🗑️ 報廢', size: 'sm', color: '#666666' },
                                    { type: 'text', text: `${weekStats.removed || 0} 件`, size: 'sm', weight: 'bold', align: 'end', color: '#FF5551' }
                                ]},
                                { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                                    { type: 'text', text: '📦 在庫', size: 'sm', color: '#666666' },
                                    { type: 'text', text: `${weekStats.in_stock || 0} 件`, size: 'sm', weight: 'bold', align: 'end' }
                                ]}
                            ]
                        }
                    }
                }]
            });
            return;
        }

        // ===== 最近登記 =====
        if (text.includes('最近') || text.includes('剛剛') || text.includes('剛才')) {
            const recentItems = db.prepare(`
                SELECT p.name, i.quantity, i.created_at
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                ORDER BY i.created_at DESC
                LIMIT 5
            `).all();

            if (recentItems.length === 0) {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '還沒有登記任何商品喔～\n\n👉 快去登記：\n' + baseUrl + '/quick-register' }]
                });
            } else {
                let itemList = recentItems.map((item, i) => `${i+1}. ${item.name}（${item.quantity}個）`).join('\n');
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: `📝 最近登記的商品：\n\n${itemList}` }]
                });
            }
            return;
        }

        // ===== 教學 =====
        if (text.includes('教學') || text.includes('怎麼用') || text.includes('教我')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `📚 潮欣小幫手使用教學\n\n` +
                          `【登記商品】\n` +
                          `1. 打開網頁 → 快速商品登記\n` +
                          `2. 輸入條碼（或掃描）\n` +
                          `3. 填寫商品資訊、選效期\n` +
                          `4. 確認登記，完成！\n\n` +
                          `【查看庫存】\n` +
                          `打開網頁 → 庫存管理\n` +
                          `可以看到所有商品和效期\n\n` +
                          `【LINE 指令】\n` +
                          `• 效期 → 查效期狀況\n` +
                          `• 今天 → 今天到期的\n` +
                          `• 庫存 → 查庫存數量\n` +
                          `• 報表 → 本週統計\n\n` +
                          `👉 ${baseUrl}`
                }]
            });
            return;
        }

        // ===== 感謝回應 =====
        if (text.includes('謝謝') || text.includes('感謝') || text.includes('3q') || text.includes('thank')) {
            const responses = [
                '不客氣！有需要隨時叫我～ 😊',
                '不會不會～這是我應該做的！💪',
                '能幫上忙太好了！🧡',
                '客氣啦～繼續加油喔！✨',
                '嘿嘿，小事一樁！😄'
            ];
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: responses[Math.floor(Math.random() * responses.length)] }]
            });
            return;
        }

        // ===== 鼓勵回應 =====
        if (text.includes('辛苦') || text.includes('累') || text.includes('煩')) {
            const responses = [
                '辛苦了！你真的很棒 💪\n休息一下，喝杯水吧～ 🥤',
                '加油加油！你已經做得很好了 ✨',
                '累了就休息一下，我會幫你盯著效期的！😊',
                '深呼吸～一切都會沒事的 🧡',
                '你很努力了！給自己一個擁抱吧～ 🤗'
            ];
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: responses[Math.floor(Math.random() * responses.length)] }]
            });
            return;
        }

        // ===== 加油回應 =====
        if (text.includes('加油')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '你也加油！我們一起努力 💪✨\n有我在，效期管理交給我！' }]
            });
            return;
        }

        // ===== 隱藏彩蛋 =====
        if (text.includes('我愛你') || text.includes('愛你')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '啊...突然告白好害羞 😳\n我...我也很喜歡幫你管理效期啦！💕' }]
            });
            return;
        }

        if (text.includes('笨蛋') || text.includes('白痴')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '嗚嗚...人家只是個小幫手啦 😢\n不要罵我，我會更努力的！' }]
            });
            return;
        }

        if (text.includes('好可愛') || text.includes('可愛')) {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '欸嘿嘿～謝謝誇獎！😆\n你也很可愛喔！（？' }]
            });
            return;
        }

        if (text === '666' || text === '厲害' || text === '讚') {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '666！🎉\n你更厲害！繼續保持～ ✨' }]
            });
            return;
        }

        // 沒有匹配的關鍵字，不回應
        return null;
    }

    /**
     * 回覆溫層查詢
     */
    async function replyTempQuery(client, replyToken, tempValue, tempName, baseUrl) {
        const items = db.prepare(`
            SELECT COUNT(*) as count FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.status = 'in_stock' AND p.storage_temp = ?
        `).get(tempValue);

        await client.replyMessage({
            replyToken: replyToken,
            messages: [{
                type: 'text',
                text: `${tempName} 商品目前有 ${items.count} 件在庫喔！\n\n👉 查看詳情：\n${baseUrl}/inventory`
            }]
        });
    }

    /**
     * 建立效期報告 Flex
     */
    function createExpiryReportFlex(total, expiring, expired, baseUrl) {
        return {
            type: 'flex',
            altText: '效期狀況報告',
            contents: {
                type: 'bubble',
                size: 'kilo',
                header: {
                    type: 'box', layout: 'vertical', paddingAll: '15px', backgroundColor: '#FFF8F0',
                    contents: [{ type: 'text', text: '📊 效期狀況報告', weight: 'bold', size: 'lg', color: '#F7941D' }]
                },
                body: {
                    type: 'box', layout: 'vertical', paddingAll: '15px',
                    contents: [
                        { type: 'box', layout: 'horizontal', contents: [
                            { type: 'text', text: '總庫存', size: 'sm', color: '#666666', flex: 2 },
                            { type: 'text', text: `${total} 件`, size: 'sm', weight: 'bold', flex: 2 }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                            { type: 'text', text: '即將到期', size: 'sm', color: '#666666', flex: 2 },
                            { type: 'text', text: `${expiring} 件`, size: 'sm', weight: 'bold', color: expiring > 0 ? '#FF9800' : '#1DB446', flex: 2 }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                            { type: 'text', text: '已過期', size: 'sm', color: '#666666', flex: 2 },
                            { type: 'text', text: `${expired} 件`, size: 'sm', weight: 'bold', color: expired > 0 ? '#FF5551' : '#1DB446', flex: 2 }
                        ]}
                    ]
                },
                footer: {
                    type: 'box', layout: 'vertical', paddingAll: '12px',
                    contents: [{
                        type: 'button',
                        action: { type: 'uri', label: '👉 查看詳情', uri: `${baseUrl}/inventory` },
                        style: 'primary', color: '#1DB446', height: 'sm'
                    }]
                }
            }
        };
    }

    /**
     * 建立選單 Flex Message
     */
    function createMenuFlexMessage(baseUrl) {
        return {
            type: 'flex',
            altText: '潮欣小幫手選單',
            contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                    type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#F7941D',
                    contents: [
                        { type: 'text', text: '🏪 潮欣小幫手', weight: 'bold', size: 'xl', color: '#FFFFFF' },
                        { type: 'text', text: '便利商店效期管理系統', size: 'sm', color: '#FFFFFF', margin: 'sm' }
                    ]
                },
                body: {
                    type: 'box', layout: 'vertical', paddingAll: '20px',
                    contents: [
                        { type: 'text', text: '嗨～我是潮欣小幫手！', size: 'md', wrap: true },
                        { type: 'text', text: '有什麼需要幫忙的嗎？', size: 'sm', color: '#666666', margin: 'sm' },
                        { type: 'separator', margin: 'lg' },
                        { type: 'text', text: '📌 快速功能', size: 'sm', color: '#999999', margin: 'lg' },
                        { type: 'text', text: '💡 也可以輸入關鍵字喔！', size: 'xs', color: '#AAAAAA', margin: 'sm' }
                    ]
                },
                footer: {
                    type: 'box', layout: 'vertical', paddingAll: '15px', spacing: 'sm',
                    contents: [
                        { type: 'button', action: { type: 'uri', label: '🏠 前往首頁', uri: baseUrl }, style: 'primary', color: '#F7941D', height: 'sm' },
                        { type: 'button', action: { type: 'uri', label: '📱 快速商品登記', uri: `${baseUrl}/quick-register` }, style: 'secondary', height: 'sm' },
                        { type: 'button', action: { type: 'uri', label: '📋 庫存管理', uri: `${baseUrl}/inventory` }, style: 'secondary', height: 'sm' },
                        { type: 'button', action: { type: 'uri', label: '📦 商品資料庫', uri: `${baseUrl}/products` }, style: 'secondary', height: 'sm' },
                        { type: 'box', layout: 'vertical', margin: 'lg', contents: [
                            { type: 'text', text: '📝 關鍵字：效期、今天、庫存、報表', size: 'xs', color: '#999999', align: 'center', wrap: true }
                        ]}
                    ]
                }
            }
        };
    }

    /**
     * 發送效期提醒訊息
     */
    async function sendExpiryAlert(items, baseUrl) {
        const client = getClient();
        let groupId = process.env.LINE_GROUP_ID;
        
        // 也嘗試從資料庫取得
        const settings = getLineSettings();
        if (settings && settings.group_id) {
            groupId = settings.group_id;
        }
        
        if (!client || !groupId) {
            console.log('LINE Bot 未設定或沒有群組 ID');
            return { success: false, error: 'LINE Bot 未設定' };
        }

        if (items.length === 0) {
            return { success: true, message: '沒有即將到期的商品' };
        }

        const messages = [];

        // 文字提醒
        messages.push({
            type: 'text',
            text: `⚠️ 效期提醒！\n\n有 ${items.length} 個商品即將在 24 小時內到期，請儘速處理！`
        });

        // 為每個商品建立 Flex Message 卡片
        const bubbles = items.slice(0, 10).map(item => createProductBubble(item, baseUrl));

        // 加入前往網頁的按鈕
        bubbles.push({
            type: 'bubble',
            size: 'kilo',
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [{
                    type: 'text',
                    text: '👉 前往網頁處理',
                    weight: 'bold',
                    size: 'md',
                    align: 'center',
                    color: '#1DB446'
                }],
                action: {
                    type: 'uri',
                    label: '前往網頁',
                    uri: baseUrl ? `${baseUrl}/inventory` : 'https://chaoxin-helper.onrender.com/inventory'
                },
                paddingAll: '15px'
            }
        });

        messages.push({
            type: 'flex',
            altText: `效期提醒：${items.length} 個商品即將到期`,
            contents: {
                type: 'carousel',
                contents: bubbles
            }
        });

        try {
            await client.pushMessage({
                to: groupId,
                messages: messages
            });
            
            return { success: true, message: `已發送提醒，共 ${items.length} 個商品` };
        } catch (error) {
            console.error('發送 LINE 訊息失敗:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * 建立商品卡片 Bubble
     */
    function createProductBubble(item, baseUrl) {
        const expiryDate = new Date(item.expiry_date);
        const now = new Date();
        const diffHours = Math.ceil((expiryDate - now) / (1000 * 60 * 60));
        
        const tempIcons = {
            'refrigerated': '❄️ 冷藏',
            'frozen': '🧊 冷凍',
            'room_temp': '🌡️ 常溫'
        };

        const tempText = tempIcons[item.storage_temp] || '❄️ 冷藏';
        
        let urgencyColor = '#1DB446';
        let urgencyText = `還有 ${diffHours} 小時`;
        
        if (diffHours <= 0) {
            urgencyColor = '#FF5551';
            urgencyText = '⚠️ 已過期！';
        } else if (diffHours <= 6) {
            urgencyColor = '#FF5551';
            urgencyText = `⚠️ 僅剩 ${diffHours} 小時！`;
        } else if (diffHours <= 12) {
            urgencyColor = '#FF9800';
            urgencyText = `還有 ${diffHours} 小時`;
        }

        return {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#F7F7F7',
                contents: [{ type: 'text', text: item.name, weight: 'bold', size: 'md', wrap: true, maxLines: 2 }]
            },
            body: {
                type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm',
                contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: '效期', size: 'sm', color: '#999999', flex: 2 },
                        { type: 'text', text: expiryDate.toLocaleDateString('zh-TW'), size: 'sm', flex: 3 }
                    ]},
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: '倒數', size: 'sm', color: '#999999', flex: 2 },
                        { type: 'text', text: urgencyText, size: 'sm', color: urgencyColor, weight: 'bold', flex: 3 }
                    ]},
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: '溫層', size: 'sm', color: '#999999', flex: 2 },
                        { type: 'text', text: tempText, size: 'sm', flex: 3 }
                    ]},
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: '數量', size: 'sm', color: '#999999', flex: 2 },
                        { type: 'text', text: `${item.quantity} 個`, size: 'sm', flex: 3 }
                    ]}
                ]
            },
            footer: {
                type: 'box', layout: 'vertical', paddingAll: '12px',
                contents: [{
                    type: 'button',
                    action: { type: 'postback', label: '✅ 已下架', data: `action=remove&id=${item.id}`, displayText: `標記「${item.name}」已下架` },
                    style: 'primary', color: '#1DB446', height: 'sm'
                }]
            }
        };
    }

    return {
        handleEvent,
        sendExpiryAlert,
        getClient,
        getLineSettings
    };
};
