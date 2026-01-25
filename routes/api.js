/**
 * 通用 API 路由 (PostgreSQL 版本)
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得系統設定
    router.get('/settings', async (req, res) => {
        try {
            const result = await db.query('SELECT key, value FROM settings');
            const settingsObj = {};
            result.rows.forEach(s => { settingsObj[s.key] = s.value; });
            res.json(settingsObj);
        } catch (error) {
            console.error('取得設定失敗:', error);
            res.status(500).json({ error: '取得設定失敗' });
        }
    });

    // 更新系統設定
    router.post('/settings', async (req, res) => {
        try {
            const { key, value } = req.body;
            await db.query(`
                INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
            `, [key, value]);
            res.json({ success: true, message: '設定已更新' });
        } catch (error) {
            console.error('更新設定失敗:', error);
            res.status(500).json({ error: '更新設定失敗' });
        }
    });

    // 批次更新設定
    router.post('/settings/batch', async (req, res) => {
        try {
            const settings = req.body;
            for (const [key, value] of Object.entries(settings)) {
                await db.query(`
                    INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
                `, [key, value]);
            }
            res.json({ success: true, message: '設定已更新' });
        } catch (error) {
            console.error('批次更新設定失敗:', error);
            res.status(500).json({ error: '更新設定失敗' });
        }
    });

    // 取得儀表板統計
    router.get('/dashboard', async (req, res) => {
        try {
            const expiringResult = await db.query(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' 
                AND expiry_date <= NOW() + INTERVAL '24 hours'
                AND expiry_date > NOW()
            `);

            const expiredResult = await db.query(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' AND expiry_date <= NOW()
            `);

            const totalResult = await db.query(`
                SELECT COUNT(*) as count FROM inventory WHERE status = 'in_stock'
            `);

            const todayResult = await db.query(`
                SELECT COUNT(*) as count FROM inventory WHERE DATE(created_at) = CURRENT_DATE
            `);

            res.json({
                expiring: parseInt(expiringResult.rows[0].count),
                expired: parseInt(expiredResult.rows[0].count),
                total: parseInt(totalResult.rows[0].count),
                today: parseInt(todayResult.rows[0].count)
            });
        } catch (error) {
            console.error('取得儀表板資料失敗:', error);
            res.status(500).json({ error: '取得資料失敗' });
        }
    });

    // 取得即將到期商品列表（排除已過期）
    router.get('/expiring', async (req, res) => {
        try {
            const hours = req.query.hours || 24;
            const result = await db.query(`
                SELECT i.id, i.quantity, i.expiry_date, i.created_at,
                       p.barcode, p.name, p.category, p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = 'in_stock'
                AND i.expiry_date <= NOW() + INTERVAL '1 hour' * $1
                AND i.expiry_date > NOW()
                ORDER BY i.expiry_date ASC
            `, [hours]);
            
            res.json(result.rows);
        } catch (error) {
            console.error('取得即將到期商品失敗:', error);
            res.status(500).json({ error: '取得資料失敗' });
        }
    });

    return router;
};
