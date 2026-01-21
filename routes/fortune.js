/**
 * 潮欣小幫手 2.0 - 抽籤 API 路由
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();
    const fortuneService = require('../services/fortune')(db);

    /**
     * 初始化籤卡資料
     */
    router.post('/init', (req, res) => {
        try {
            fortuneService.initFortuneCards();
            res.json({ success: true, message: '籤卡資料初始化完成' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 抽籤
     * POST /api/fortune/draw
     * Body: { userId, triggerType }
     */
    router.post('/draw', (req, res) => {
        try {
            const { userId, triggerType } = req.body;
            
            if (!userId) {
                return res.status(400).json({ error: '缺少 userId' });
            }

            const card = fortuneService.drawFortune(userId, triggerType || 'manual');
            res.json({
                success: true,
                card,
                message: '抽籤成功！'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得抽籤歷史
     * GET /api/fortune/history/:userId
     */
    router.get('/history/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const limit = parseInt(req.query.limit) || 10;
            
            const history = fortuneService.getFortuneHistory(userId, limit);
            res.json(history);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得抽籤統計
     * GET /api/fortune/stats/:userId
     */
    router.get('/stats/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const stats = fortuneService.getFortuneStats(userId);
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得所有籤卡（圖鑑）
     * GET /api/fortune/cards
     */
    router.get('/cards', (req, res) => {
        try {
            const cards = fortuneService.getAllCards();
            res.json(cards);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得用戶已收集的籤卡
     * GET /api/fortune/collection/:userId
     */
    router.get('/collection/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const collected = fortuneService.getCollectedCards(userId);
            const all = fortuneService.getAllCards();
            
            res.json({
                collected,
                total: all.length,
                collectedCount: collected.length,
                progress: Math.floor((collected.length / all.length) * 100)
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 檢查今日是否已抽過每日籤
     * GET /api/fortune/daily-check/:userId
     */
    router.get('/daily-check/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const hasDrawn = fortuneService.hasDrawnToday(userId);
            res.json({ hasDrawnToday: hasDrawn });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
