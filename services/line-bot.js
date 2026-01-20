/**
 * LINE Bot 服務
 * 處理 LINE 訊息和互動
 */

const line = require('@line/bot-sdk');

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
                    text: `✅ 已標記「${productName}」為「已下架」，不會再收到提醒。`
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

        // 簡單的關鍵字回應
        if (text.includes('效期') || text.includes('到期')) {
            const expiringItems = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' 
                AND expiry_date <= datetime('now', '+24 hours')
            `).get();

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `📊 效期狀況報告\n\n目前有 ${expiringItems.count} 個商品即將在 24 小時內到期喔！\n\n👉 前往系統查看詳情`
                }]
            });
        }

        return null;
    }

    /**
     * 發送效期提醒訊息
     */
    async function sendExpiryAlert(items, baseUrl) {
        const client = getClient();
        const settings = getLineSettings();
        
        if (!client || !settings || !settings.group_id) {
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
                contents: [
                    {
                        type: 'text',
                        text: '👉 前往網頁處理',
                        weight: 'bold',
                        size: 'md',
                        align: 'center',
                        color: '#1DB446'
                    }
                ],
                action: {
                    type: 'uri',
                    label: '前往網頁',
                    uri: baseUrl ? `${baseUrl}/inventory` : 'https://example.com/inventory'
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
                to: settings.group_id,
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
        
        let urgencyColor = '#1DB446'; // 綠色
        let urgencyText = `還有 ${diffHours} 小時`;
        
        if (diffHours <= 6) {
            urgencyColor = '#FF5551'; // 紅色
            urgencyText = `⚠️ 僅剩 ${diffHours} 小時！`;
        } else if (diffHours <= 12) {
            urgencyColor = '#FF9800'; // 橘色
            urgencyText = `還有 ${diffHours} 小時`;
        }

        return {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        text: item.name,
                        weight: 'bold',
                        size: 'md',
                        wrap: true,
                        maxLines: 2
                    }
                ],
                backgroundColor: '#F7F7F7',
                paddingAll: '12px'
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            {
                                type: 'text',
                                text: '效期',
                                size: 'sm',
                                color: '#999999',
                                flex: 2
                            },
                            {
                                type: 'text',
                                text: expiryDate.toLocaleDateString('zh-TW'),
                                size: 'sm',
                                flex: 3
                            }
                        ]
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            {
                                type: 'text',
                                text: '倒數',
                                size: 'sm',
                                color: '#999999',
                                flex: 2
                            },
                            {
                                type: 'text',
                                text: urgencyText,
                                size: 'sm',
                                color: urgencyColor,
                                weight: 'bold',
                                flex: 3
                            }
                        ],
                        margin: 'sm'
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            {
                                type: 'text',
                                text: '溫層',
                                size: 'sm',
                                color: '#999999',
                                flex: 2
                            },
                            {
                                type: 'text',
                                text: tempText,
                                size: 'sm',
                                flex: 3
                            }
                        ],
                        margin: 'sm'
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            {
                                type: 'text',
                                text: '數量',
                                size: 'sm',
                                color: '#999999',
                                flex: 2
                            },
                            {
                                type: 'text',
                                text: `${item.quantity} 個`,
                                size: 'sm',
                                flex: 3
                            }
                        ],
                        margin: 'sm'
                    }
                ],
                paddingAll: '12px',
                spacing: 'sm'
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'button',
                        action: {
                            type: 'postback',
                            label: '✅ 已下架',
                            data: `action=remove&id=${item.id}`,
                            displayText: `標記「${item.name}」已下架`
                        },
                        style: 'primary',
                        color: '#1DB446',
                        height: 'sm'
                    }
                ],
                paddingAll: '12px'
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
