/**
 * 潮欣小幫手 2.0 - 遊戲化 API 路由 (PostgreSQL 版本)
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();
    const gamificationService = require('../services/gamification')(db);

    // 每日簽到
    router.post('/checkin', async (req, res) => {
        try {
            const { userId, displayName } = req.body;
            if (!userId) return res.status(400).json({ error: '缺少 userId' });
            const result = await gamificationService.dailyCheckin(userId, displayName);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得用戶遊戲資料
    router.get('/user/:userId', async (req, res) => {
        try {
            const data = await gamificationService.getUserGameData(req.params.userId);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得用戶徽章
    router.get('/badges/:userId', async (req, res) => {
        try {
            const badges = await gamificationService.getUserBadges(req.params.userId);
            res.json(badges);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得所有徽章（含用戶狀態）
    router.get('/badges-all/:userId', async (req, res) => {
        try {
            const badges = await gamificationService.getAllBadgesWithStatus(req.params.userId);
            res.json(badges);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得排行榜
    router.get('/leaderboard', async (req, res) => {
        try {
            const type = req.query.type || 'weekly';
            const limit = parseInt(req.query.limit) || 10;
            const leaderboard = await gamificationService.getLeaderboard(type, limit);
            res.json(leaderboard);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得今日戰報
    router.get('/daily-report', async (req, res) => {
        try {
            const report = await gamificationService.getDailyReport();
            res.json(report);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 記錄商品登記
    router.post('/record-registration', async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: '缺少 userId' });
            const result = await gamificationService.recordRegistration(userId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 記錄商品下架
    router.post('/record-removal', async (req, res) => {
        try {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: '缺少 userId' });
            const result = await gamificationService.recordRemoval(userId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 取得等級設定
    router.get('/levels', (req, res) => {
        res.json(gamificationService.LEVEL_CONFIG);
    });

    // 取得 XP 獎勵設定
    router.get('/xp-rewards', (req, res) => {
        res.json(gamificationService.XP_REWARDS);
    });

    return router;
};
