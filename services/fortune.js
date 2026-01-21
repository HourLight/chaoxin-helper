/**
 * 潮欣小幫手 2.0 - 抽籤服務
 * 處理籤卡抽取、保底機制、歷史記錄
 */

const path = require('path');
const fs = require('fs');

module.exports = function(db) {
    
    /**
     * 初始化籤卡資料（從 JSON 匯入 SQLite）
     */
    function initFortuneCards() {
        try {
            // 檢查是否已有籤卡資料
            const count = db.prepare('SELECT COUNT(*) as count FROM fortune_cards').get();
            if (count.count > 0) {
                console.log(`✅ 籤卡資料已存在，共 ${count.count} 張`);
                return;
            }

            // 讀取 JSON 檔案
            const jsonPath = path.join(__dirname, '..', 'database', 'fortune-cards.json');
            const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            
            // 批次插入
            const stmt = db.prepare(`
                INSERT INTO fortune_cards (card_code, series, rarity, title, subtitle, scenario, message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const insertMany = db.transaction((cards) => {
                for (const card of cards) {
                    stmt.run(
                        card.code,
                        card.series,
                        card.rarity,
                        card.title,
                        card.subtitle || null,
                        card.scenario,
                        card.message
                    );
                }
            });

            insertMany(jsonData.cards);
            console.log(`✅ 成功匯入 ${jsonData.cards.length} 張籤卡`);
            
        } catch (error) {
            console.error('匯入籤卡失敗:', error);
        }
    }

    /**
     * 抽籤主函數
     * @param {string} userId - LINE userId
     * @param {string} triggerType - 觸發類型: manual, task_complete, daily, streak
     * @returns {object} 抽中的籤卡資訊
     */
    function drawFortune(userId, triggerType = 'manual') {
        // 取得用戶統計
        let userStats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
        
        // 如果用戶不存在，建立新記錄
        if (!userStats) {
            db.prepare(`
                INSERT INTO user_stats (user_id, display_name, total_xp, level, streak_days, lucky_value, total_draws)
                VALUES (?, ?, 0, 1, 0, 0, 0)
            `).run(userId, '店員');
            userStats = { lucky_value: 0, total_draws: 0 };
        }

        // 計算機率調整
        let luckyBonus = 0;
        
        // 保底機制：累積 10 次沒出 SR 以上，保底 SR
        if (userStats.lucky_value >= 10) {
            luckyBonus = 0.50; // 大幅提升機率
        } else if (userStats.lucky_value >= 7) {
            luckyBonus = 0.10; // 小幅提升
        }

        // 任務完成後機率加成
        let taskBonus = 1;
        if (triggerType === 'task_complete') {
            taskBonus = 1.5;
        } else if (triggerType === 'streak') {
            taskBonus = 2; // 連續簽到獎勵更大
        }

        // 抽籤決定稀有度
        const roll = Math.random();
        let rarity;

        // 機率分配：SSR 3%, SR 12%, R 25%, Quest 60%
        const ssrRate = 0.03 * taskBonus + luckyBonus * 0.1;
        const srRate = 0.12 * taskBonus + luckyBonus * 0.3;
        const rRate = 0.25;

        if (roll < ssrRate) {
            rarity = 'SSR';
        } else if (roll < ssrRate + srRate) {
            rarity = 'SR';
        } else if (roll < ssrRate + srRate + rRate) {
            rarity = 'R';
        } else {
            rarity = 'Quest';
        }

        // 保底觸發
        if (userStats.lucky_value >= 10 && (rarity === 'R' || rarity === 'Quest')) {
            rarity = 'SR'; // 強制升級為 SR
        }

        // 從對應稀有度隨機抽一張
        const card = db.prepare(`
            SELECT * FROM fortune_cards 
            WHERE rarity = ? 
            ORDER BY RANDOM() 
            LIMIT 1
        `).get(rarity);

        if (!card) {
            // 如果沒找到對應稀有度的卡，隨機抽一張
            const fallbackCard = db.prepare('SELECT * FROM fortune_cards ORDER BY RANDOM() LIMIT 1').get();
            return fallbackCard;
        }

        // 記錄抽籤歷史
        db.prepare(`
            INSERT INTO fortune_history (user_id, card_id, trigger_type)
            VALUES (?, ?, ?)
        `).run(userId, card.id, triggerType);

        // 更新幸運值（抽到 SR 以上重置，否則 +1）
        const newLuckyValue = (rarity === 'SSR' || rarity === 'SR') ? 0 : (userStats.lucky_value || 0) + 1;
        
        // 更新用戶統計
        db.prepare(`
            UPDATE user_stats 
            SET lucky_value = ?, 
                total_draws = total_draws + 1,
                updated_at = datetime('now')
            WHERE user_id = ?
        `).run(newLuckyValue, userId);

        return {
            ...card,
            isGuaranteed: userStats.lucky_value >= 10 && (rarity === 'SR'),
            luckyValueReset: rarity === 'SSR' || rarity === 'SR'
        };
    }

    /**
     * 取得用戶抽籤歷史
     */
    function getFortuneHistory(userId, limit = 10) {
        return db.prepare(`
            SELECT fh.*, fc.card_code, fc.title, fc.subtitle, fc.rarity, fc.message
            FROM fortune_history fh
            JOIN fortune_cards fc ON fh.card_id = fc.id
            WHERE fh.user_id = ?
            ORDER BY fh.drawn_at DESC
            LIMIT ?
        `).all(userId, limit);
    }

    /**
     * 取得今日是否已抽過每日籤
     */
    function hasDrawnToday(userId) {
        const today = new Date().toISOString().split('T')[0];
        const result = db.prepare(`
            SELECT COUNT(*) as count FROM fortune_history
            WHERE user_id = ? AND date(drawn_at) = date(?)
            AND trigger_type = 'daily'
        `).get(userId, today);
        return result.count > 0;
    }

    /**
     * 建立籤卡 Flex Message
     */
    function createFortuneFlexMessage(card) {
        const rarityColors = {
            'SSR': '#FFD700',  // 金色
            'SR': '#9B59B6',   // 紫色
            'R': '#3498DB',    // 藍色
            'Quest': '#E74C3C' // 紅色
        };

        const rarityEmoji = {
            'SSR': '🌟',
            'SR': '✨',
            'R': '💫',
            'Quest': '⚔️'
        };

        const rarityText = {
            'SSR': '大吉',
            'SR': '中吉',
            'R': '小吉',
            'Quest': '挑戰'
        };

        return {
            type: 'flex',
            altText: `🎴 ${rarityEmoji[card.rarity]} ${card.title}`,
            contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: rarityColors[card.rarity],
                    paddingAll: '15px',
                    contents: [
                        {
                            type: 'text',
                            text: `${rarityEmoji[card.rarity]} ${card.rarity} - ${rarityText[card.rarity]} ${rarityEmoji[card.rarity]}`,
                            color: '#FFFFFF',
                            align: 'center',
                            weight: 'bold',
                            size: 'md'
                        }
                    ]
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'md',
                    paddingAll: '20px',
                    contents: [
                        {
                            type: 'text',
                            text: `✨ ${card.title}`,
                            weight: 'bold',
                            size: 'xl',
                            align: 'center',
                            color: '#333333'
                        },
                        {
                            type: 'text',
                            text: card.subtitle || '',
                            size: 'md',
                            color: '#888888',
                            align: 'center',
                            margin: 'sm'
                        },
                        {
                            type: 'separator',
                            margin: 'lg'
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'lg',
                            paddingAll: '12px',
                            backgroundColor: '#F7F7F7',
                            cornerRadius: '8px',
                            contents: [
                                {
                                    type: 'text',
                                    text: `📍 ${card.scenario}`,
                                    size: 'sm',
                                    color: '#666666',
                                    wrap: true
                                }
                            ]
                        },
                        {
                            type: 'text',
                            text: card.message,
                            size: 'md',
                            wrap: true,
                            margin: 'lg',
                            color: '#444444'
                        }
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    paddingAll: '15px',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'button',
                            action: {
                                type: 'message',
                                label: '🎴 再抽一張',
                                text: '抽籤'
                            },
                            style: 'primary',
                            color: '#FF6B35',
                            height: 'sm'
                        },
                        {
                            type: 'text',
                            text: `籤號：${card.card_code}`,
                            size: 'xs',
                            color: '#AAAAAA',
                            align: 'center',
                            margin: 'sm'
                        }
                    ]
                }
            }
        };
    }

    /**
     * 取得籤卡統計
     */
    function getFortuneStats(userId) {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_draws,
                SUM(CASE WHEN fc.rarity = 'SSR' THEN 1 ELSE 0 END) as ssr_count,
                SUM(CASE WHEN fc.rarity = 'SR' THEN 1 ELSE 0 END) as sr_count,
                SUM(CASE WHEN fc.rarity = 'R' THEN 1 ELSE 0 END) as r_count,
                SUM(CASE WHEN fc.rarity = 'Quest' THEN 1 ELSE 0 END) as quest_count
            FROM fortune_history fh
            JOIN fortune_cards fc ON fh.card_id = fc.id
            WHERE fh.user_id = ?
        `).get(userId);

        const userStats = db.prepare('SELECT lucky_value FROM user_stats WHERE user_id = ?').get(userId);

        return {
            ...stats,
            lucky_value: userStats?.lucky_value || 0,
            until_guarantee: Math.max(0, 10 - (userStats?.lucky_value || 0))
        };
    }

    /**
     * 取得所有籤卡列表（用於網頁顯示圖鑑）
     */
    function getAllCards() {
        return db.prepare('SELECT * FROM fortune_cards ORDER BY card_code').all();
    }

    /**
     * 取得用戶已收集的籤卡（圖鑑功能）
     */
    function getCollectedCards(userId) {
        return db.prepare(`
            SELECT DISTINCT fc.*
            FROM fortune_history fh
            JOIN fortune_cards fc ON fh.card_id = fc.id
            WHERE fh.user_id = ?
            ORDER BY fc.card_code
        `).all(userId);
    }

    return {
        initFortuneCards,
        drawFortune,
        getFortuneHistory,
        hasDrawnToday,
        createFortuneFlexMessage,
        getFortuneStats,
        getAllCards,
        getCollectedCards
    };
};
