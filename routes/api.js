/**
 * 通用 API 路由
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得系統設定
    router.get('/settings', (req, res) => {
        try {
            const settings = db.prepare('SELECT key, value FROM settings').all();
            const settingsObj = {};
            settings.forEach(s => {
                settingsObj[s.key] = s.value;
            });
            res.json(settingsObj);
        } catch (error) {
            console.error('取得設定失敗:', error);
            res.status(500).json({ error: '取得設定失敗' });
        }
    });

    // 更新系統設定
    router.post('/settings', (req, res) => {
        try {
            const { key, value } = req.body;
            const stmt = db.prepare(`
                INSERT INTO settings (key, value, updated_at) 
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
            `);
            stmt.run(key, value, value);
            res.json({ success: true, message: '設定已更新' });
        } catch (error) {
            console.error('更新設定失敗:', error);
            res.status(500).json({ error: '更新設定失敗' });
        }
    });

    // 批次更新設定
    router.post('/settings/batch', (req, res) => {
        try {
            const settings = req.body;
            const stmt = db.prepare(`
                INSERT INTO settings (key, value, updated_at) 
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
            `);
            
            const transaction = db.transaction(() => {
                for (const [key, value] of Object.entries(settings)) {
                    stmt.run(key, value, value);
                }
            });
            
            transaction();
            res.json({ success: true, message: '設定已更新' });
        } catch (error) {
            console.error('批次更新設定失敗:', error);
            res.status(500).json({ error: '更新設定失敗' });
        }
    });

    // 取得儀表板統計
    router.get('/dashboard', (req, res) => {
        try {
            // 取得即將到期商品數量（24小時內）
            const expiringCount = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' 
                AND expiry_date <= datetime('now', '+24 hours')
                AND expiry_date > datetime('now')
            `).get();

            // 取得已過期商品數量
            const expiredCount = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock' 
                AND expiry_date <= datetime('now')
            `).get();

            // 取得總庫存數量
            const totalCount = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE status = 'in_stock'
            `).get();

            // 取得今日登記數量
            const todayCount = db.prepare(`
                SELECT COUNT(*) as count FROM inventory 
                WHERE date(created_at) = date('now')
            `).get();

            res.json({
                expiring: expiringCount.count,
                expired: expiredCount.count,
                total: totalCount.count,
                today: todayCount.count
            });
        } catch (error) {
            console.error('取得儀表板資料失敗:', error);
            res.status(500).json({ error: '取得資料失敗' });
        }
    });

    // 取得即將到期商品列表
    router.get('/expiring', (req, res) => {
        try {
            const hours = req.query.hours || 24;
            const items = db.prepare(`
                SELECT 
                    i.id,
                    i.quantity,
                    i.expiry_date,
                    i.created_at,
                    p.barcode,
                    p.name,
                    p.category,
                    p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = 'in_stock'
                AND i.expiry_date <= datetime('now', '+' || ? || ' hours')
                ORDER BY i.expiry_date ASC
            `).all(hours);
            
            res.json(items);
        } catch (error) {
            console.error('取得即將到期商品失敗:', error);
            res.status(500).json({ error: '取得資料失敗' });
        }
    });

    return router;
};
