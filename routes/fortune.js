/**
 * 潮欣小幫手 2.0 - 抽籤 API 路由 (PostgreSQL 版本)
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();
    const fortuneService = require('../services/fortune')(db);

    // 初始化籤卡資料
    router.post('/init', async (req, res) => {
        try {
            await fortuneService.initFortuneCards();
            res.json({ success: true, message: '籤卡資料初始化完成' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 抽籤
    router.post('/draw', async (req, res) => {
        try {
            const { userId, triggerType } = req.body;
            if (!userId) return res.status(400).json({ error: '缺少 userId' });

            const card = await fortuneService.drawFortune(userId, triggerType || 'manual');
            res.json({ success: true, card, message: '抽籤成功！' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得抽籤歷史
    router.get('/history/:userId', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const history = await fortuneService.getFortuneHistory(req.params.userId, limit);
            res.json(history);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得抽籤統計
    router.get('/stats/:userId', async (req, res) => {
        try {
            const stats = await fortuneService.getFortuneStats(req.params.userId);
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得所有籤卡（圖鑑）
    router.get('/cards', async (req, res) => {
        try {
            const cards = await fortuneService.getAllCards();
            res.json(cards);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得用戶已收集的籤卡
    router.get('/collection/:userId', async (req, res) => {
        try {
            const collected = await fortuneService.getCollectedCards(req.params.userId);
            const all = await fortuneService.getAllCards();
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

    // 檢查今日是否已抽過每日籤
    router.get('/daily-check/:userId', async (req, res) => {
        try {
            const hasDrawn = await fortuneService.hasDrawnToday(req.params.userId);
            res.json({ hasDrawnToday: hasDrawn });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
