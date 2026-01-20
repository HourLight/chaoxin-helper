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
        const baseUrl = process.env.BASE_URL || 'https://chaoxin-helper.onrender.com';

        // 關鍵字觸發選單
        const menuKeywords = [
            '潮欣小幫手', '小幫手', '店長助理', '小助理', 
            '小妞', '潮欣小妞', '幫助', 'help', '選單', 'menu',
            '你好', '嗨', 'hi', 'hello'
        ];

        const shouldShowMenu = menuKeywords.some(keyword => text.includes(keyword));

        if (shouldShowMenu) {
            // 發送選單 Flex Message
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [createMenuFlexMessage(baseUrl)]
            });
            return;
        }

        // 效期查詢關鍵字
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

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'flex',
                    altText: '效期狀況報告',
                    contents: {
                        type: 'bubble',
                        size: 'kilo',
                        header: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [{
                                type: 'text',
                                text: '📊 效期狀況報告',
                                weight: 'bold',
                                size: 'lg',
                                color: '#F7941D'
                            }],
                            backgroundColor: '#FFF8F0',
                            paddingAll: '15px'
                        },
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    contents: [
                                        { type: 'text', text: '總庫存', size: 'sm', color: '#666666', flex: 2 },
                                        { type: 'text', text: `${totalItems.count} 件`, size: 'sm', weight: 'bold', flex: 2 }
                                    ]
                                },
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    contents: [
                                        { type: 'text', text: '即將到期', size: 'sm', color: '#666666', flex: 2 },
                                        { type: 'text', text: `${expiringItems.count} 件`, size: 'sm', weight: 'bold', color: expiringItems.count > 0 ? '#FF5551' : '#1DB446', flex: 2 }
                                    ],
                                    margin: 'md'
                                }
                            ],
                            paddingAll: '15px'
                        },
                        footer: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [{
                                type: 'button',
                                action: {
                                    type: 'uri',
                                    label: '👉 查看詳情',
                                    uri: `${baseUrl}/inventory`
                                },
                                style: 'primary',
                                color: '#1DB446',
                                height: 'sm'
                            }],
                            paddingAll: '12px'
                        }
                    }
                }]
            });
            return;
        }

        // 庫存查詢關鍵字
        if (text.includes('庫存') || text.includes('有什麼')) {
            const totalItems = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock'
            `).get();

            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: `📦 目前庫存共 ${totalItems.count} 件商品\n\n👉 前往查看：\n${baseUrl}/inventory`
                }]
            });
            return;
        }

        return null;
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
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: '🏪 潮欣小幫手',
                            weight: 'bold',
                            size: 'xl',
                            color: '#FFFFFF'
                        },
                        {
                            type: 'text',
                            text: '便利商店效期管理系統',
                            size: 'sm',
                            color: '#FFFFFF',
                            margin: 'sm'
                        }
                    ],
                    backgroundColor: '#F7941D',
                    paddingAll: '20px'
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: '嗨～我是潮欣小幫手！',
                            size: 'md',
                            wrap: true
                        },
                        {
                            type: 'text',
                            text: '有什麼我可以幫忙的嗎？',
                            size: 'sm',
                            color: '#666666',
                            margin: 'sm',
                            wrap: true
                        },
                        {
                            type: 'separator',
                            margin: 'lg'
                        },
                        {
                            type: 'text',
                            text: '📌 快速功能',
                            size: 'sm',
                            color: '#999999',
                            margin: 'lg'
                        }
                    ],
                    paddingAll: '20px'
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'button',
                            action: {
                                type: 'uri',
                                label: '🏠 前往首頁',
                                uri: baseUrl
                            },
                            style: 'primary',
                            color: '#F7941D',
                            height: 'sm'
                        },
                        {
                            type: 'button',
                            action: {
                                type: 'uri',
                                label: '📱 快速商品登記',
                                uri: `${baseUrl}/quick-register`
                            },
                            style: 'secondary',
                            height: 'sm',
                            margin: 'sm'
                        },
                        {
                            type: 'button',
                            action: {
                                type: 'uri',
                                label: '📋 庫存管理',
                                uri: `${baseUrl}/inventory`
                            },
                            style: 'secondary',
                            height: 'sm',
                            margin: 'sm'
                        },
                        {
                            type: 'button',
                            action: {
                                type: 'uri',
                                label: '📦 商品資料庫',
                                uri: `${baseUrl}/products`
                            },
                            style: 'secondary',
                            height: 'sm',
                            margin: 'sm'
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            contents: [{
                                type: 'text',
                                text: '💡 輸入「效期」可查詢到期狀況',
                                size: 'xs',
                                color: '#999999',
                                align: 'center'
                            }],
                            margin: 'lg'
                        }
                    ],
                    paddingAll: '15px'
                }
            }
        };
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
