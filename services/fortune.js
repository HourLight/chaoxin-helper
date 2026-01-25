/**
 * 潮欣小幫手 2.0 - 抽籤服務 (PostgreSQL 版本)
 */

const path = require('path');
const fs = require('fs');

module.exports = function(db) {
    
    // 初始化籤卡資料
    async function initFortuneCards() {
        try {
            const countResult = await db.query('SELECT COUNT(*) as count FROM fortune_cards');
            if (parseInt(countResult.rows[0].count) > 0) {
                console.log(`✅ 籤卡資料已存在，共 ${countResult.rows[0].count} 張`);
                return;
            }

            const jsonPath = path.join(__dirname, '..', 'database', 'fortune-cards.json');
            const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            
            for (const card of jsonData.cards) {
                await db.query(`
                    INSERT INTO fortune_cards (card_code, series, rarity, title, subtitle, scenario, message)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (card_code) DO NOTHING
                `, [card.code, card.series, card.rarity, card.title, card.subtitle || null, card.scenario, card.message]);
            }
            console.log(`✅ 成功匯入 ${jsonData.cards.length} 張籤卡`);
        } catch (error) {
            console.error('匯入籤卡失敗:', error);
        }
    }

    // 抽籤主函數 🌿 馥靈之鑰：每一張籤都是平等的高我訊息
    async function drawFortune(userId, triggerType = 'manual') {
        // 確保用戶統計存在
        const userStatsResult = await db.query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
        
        if (userStatsResult.rows.length === 0) {
            await db.query(`
                INSERT INTO user_stats (user_id, display_name, total_xp, level, streak_days, lucky_value, total_draws)
                VALUES ($1, $2, 0, 1, 0, 0, 0)
            `, [userId, '店員']);
        }

        // 🌿 純粹隨機：130 張籤平等抽取
        const cardResult = await db.query('SELECT * FROM fortune_cards ORDER BY RANDOM() LIMIT 1');
        const card = cardResult.rows[0];

        // 記錄抽籤歷史
        await db.query('INSERT INTO fortune_history (user_id, card_id, trigger_type) VALUES ($1, $2, $3)', 
            [userId, card.id, triggerType]);

        // 更新用戶統計
        await db.query('UPDATE user_stats SET total_draws = total_draws + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1', [userId]);

        return card;
    }

    // 取得用戶抽籤歷史
    async function getFortuneHistory(userId, limit = 10) {
        const result = await db.query(`
            SELECT fh.*, fc.card_code, fc.title, fc.subtitle, fc.rarity, fc.message
            FROM fortune_history fh JOIN fortune_cards fc ON fh.card_id = fc.id
            WHERE fh.user_id = $1 ORDER BY fh.drawn_at DESC LIMIT $2
        `, [userId, limit]);
        return result.rows;
    }

    // 取得今日是否已抽過每日籤
    async function hasDrawnToday(userId) {
        const result = await db.query(`
            SELECT COUNT(*) as count FROM fortune_history
            WHERE user_id = $1 AND DATE(drawn_at) = CURRENT_DATE AND trigger_type = 'daily'
        `, [userId]);
        return parseInt(result.rows[0].count) > 0;
    }

    // 建立籤卡 Flex Message
    function createFortuneFlexMessage(card) {
        const rarityColors = { 'SSR': '#FFD700', 'SR': '#9B59B6', 'R': '#3498DB' };
        const rarityEmoji = { 'SSR': '🌟', 'SR': '✨', 'R': '💫' };
        const rarityText = { 'SSR': '大吉', 'SR': '中吉', 'R': '小吉' };

        return {
            type: 'flex',
            altText: `🎴 ${rarityEmoji[card.rarity]} ${card.title}`,
            contents: {
                type: 'bubble', size: 'mega',
                header: {
                    type: 'box', layout: 'vertical', backgroundColor: rarityColors[card.rarity], paddingAll: '15px',
                    contents: [{
                        type: 'text', text: `${rarityEmoji[card.rarity]} ${card.rarity} - ${rarityText[card.rarity]} ${rarityEmoji[card.rarity]}`,
                        color: '#FFFFFF', align: 'center', weight: 'bold', size: 'md'
                    }]
                },
                body: {
                    type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
                    contents: [
                        { type: 'text', text: `✨ ${card.title}`, weight: 'bold', size: 'xl', align: 'center', color: '#333333' },
                        { type: 'text', text: card.subtitle || '', size: 'md', color: '#888888', align: 'center', margin: 'sm' },
                        { type: 'separator', margin: 'lg' },
                        { type: 'box', layout: 'vertical', margin: 'lg', paddingAll: '12px', backgroundColor: '#F7F7F7', cornerRadius: '8px',
                            contents: [{ type: 'text', text: `📍 ${card.scenario}`, size: 'sm', color: '#666666', wrap: true }] },
                        { type: 'text', text: card.message, size: 'md', wrap: true, margin: 'lg', color: '#444444' }
                    ]
                },
                footer: {
                    type: 'box', layout: 'vertical', paddingAll: '15px', spacing: 'sm',
                    contents: [
                        { type: 'button', action: { type: 'message', label: '🎴 再抽一張', text: '抽籤' }, style: 'primary', color: '#FF6B35', height: 'sm' },
                        { type: 'text', text: `籤號：${card.card_code}`, size: 'xs', color: '#AAAAAA', align: 'center', margin: 'sm' }
                    ]
                }
            }
        };
    }

    // 取得籤卡統計
    async function getFortuneStats(userId) {
        const result = await db.query(`
            SELECT COUNT(*) as total_draws,
                SUM(CASE WHEN fc.rarity = 'SSR' THEN 1 ELSE 0 END) as ssr_count,
                SUM(CASE WHEN fc.rarity = 'SR' THEN 1 ELSE 0 END) as sr_count,
                SUM(CASE WHEN fc.rarity = 'R' THEN 1 ELSE 0 END) as r_count
            FROM fortune_history fh JOIN fortune_cards fc ON fh.card_id = fc.id WHERE fh.user_id = $1
        `, [userId]);
        return result.rows[0];
    }

    // 取得所有籤卡列表
    async function getAllCards() {
        const result = await db.query('SELECT * FROM fortune_cards ORDER BY card_code');
        return result.rows;
    }

    // 取得用戶已收集的籤卡
    async function getCollectedCards(userId) {
        const result = await db.query(`
            SELECT DISTINCT fc.* FROM fortune_history fh
            JOIN fortune_cards fc ON fh.card_id = fc.id WHERE fh.user_id = $1 ORDER BY fc.card_code
        `, [userId]);
        return result.rows;
    }

    return { initFortuneCards, drawFortune, getFortuneHistory, hasDrawnToday, createFortuneFlexMessage, getFortuneStats, getAllCards, getCollectedCards };
};
