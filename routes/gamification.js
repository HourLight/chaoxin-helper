/**
 * 潮欣小幫手 2.0 - 遊戲化 API 路由
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();
    const gamificationService = require('../services/gamification')(db);

    /**
     * 每日簽到
     * POST /api/game/checkin
     */
    router.post('/checkin', (req, res) => {
        try {
            const { userId, displayName } = req.body;
            
            if (!userId) {
                return res.status(400).json({ error: '缺少 userId' });
            }

            const result = gamificationService.dailyCheckin(userId, displayName);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得用戶遊戲資料
     * GET /api/game/user/:userId
     */
    router.get('/user/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const data = gamificationService.getUserGameData(userId);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得用戶徽章
     * GET /api/game/badges/:userId
     */
    router.get('/badges/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const badges = gamificationService.getUserBadges(userId);
            res.json(badges);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得所有徽章（含用戶狀態）
     * GET /api/game/badges-all/:userId
     */
    router.get('/badges-all/:userId', (req, res) => {
        try {
            const { userId } = req.params;
            const badges = gamificationService.getAllBadgesWithStatus(userId);
            res.json(badges);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得排行榜
     * GET /api/game/leaderboard
     */
    router.get('/leaderboard', (req, res) => {
        try {
            const type = req.query.type || 'weekly';
            const limit = parseInt(req.query.limit) || 10;
            const leaderboard = gamificationService.getLeaderboard(type, limit);
            res.json(leaderboard);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得今日戰報
     * GET /api/game/daily-report
     */
    router.get('/daily-report', (req, res) => {
        try {
            const report = gamificationService.getDailyReport();
            res.json(report);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 記錄商品登記（由其他 API 呼叫）
     * POST /api/game/record-registration
     */
    router.post('/record-registration', (req, res) => {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ error: '缺少 userId' });
            }

            const result = gamificationService.recordRegistration(userId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 記錄商品下架（由其他 API 呼叫）
     * POST /api/game/record-removal
     */
    router.post('/record-removal', (req, res) => {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ error: '缺少 userId' });
            }

            const result = gamificationService.recordRemoval(userId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * 取得等級設定
     * GET /api/game/levels
     */
    router.get('/levels', (req, res) => {
        res.json(gamificationService.LEVEL_CONFIG);
    });

    /**
     * 取得 XP 獎勵設定
     * GET /api/game/xp-rewards
     */
    router.get('/xp-rewards', (req, res) => {
        res.json(gamificationService.XP_REWARDS);
    });

    return router;
};
