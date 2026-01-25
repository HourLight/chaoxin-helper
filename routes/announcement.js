/**
 * 店長公告 API
 */
const express = require('express');
const router = express.Router();

module.exports = function(db) {
    
    // 取得目前公告
    router.get('/', async (req, res) => {
        try {
            const result = await db.query(
                'SELECT * FROM announcements WHERE is_active = true ORDER BY updated_at DESC LIMIT 1'
            );
            res.json(result.rows[0] || null);
        } catch (error) {
            console.error('取得公告失敗:', error);
            res.status(500).json({ error: '取得公告失敗' });
        }
    });

    // 取得公告歷史
    router.get('/history', async (req, res) => {
        try {
            const result = await db.query(
                'SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20'
            );
            res.json(result.rows);
        } catch (error) {
            console.error('取得公告歷史失敗:', error);
            res.status(500).json({ error: '取得公告歷史失敗' });
        }
    });

    // 發布/更新公告
    router.post('/', async (req, res) => {
        try {
            const { content, created_by } = req.body;
            
            if (!content || content.trim() === '') {
                return res.status(400).json({ error: '公告內容不能為空' });
            }

            // 將舊公告設為非啟用
            await db.query('UPDATE announcements SET is_active = false');

            // 新增新公告
            const result = await db.query(
                'INSERT INTO announcements (content, created_by, is_active) VALUES ($1, $2, true) RETURNING *',
                [content.trim(), created_by || '店長']
            );

            res.json({ success: true, announcement: result.rows[0] });
        } catch (error) {
            console.error('發布公告失敗:', error);
            res.status(500).json({ error: '發布公告失敗' });
        }
    });

    // 清除公告
    router.delete('/', async (req, res) => {
        try {
            await db.query('UPDATE announcements SET is_active = false');
            res.json({ success: true, message: '公告已清除' });
        } catch (error) {
            console.error('清除公告失敗:', error);
            res.status(500).json({ error: '清除公告失敗' });
        }
    });

    return router;
};
