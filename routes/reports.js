/**
 * 管理員報表 API
 * 潮欣小幫手 - 店員操作追蹤
 */

const express = require('express');
const router = express.Router();

module.exports = function(db) {
    
    /**
     * GET /api/reports/overview
     * 取得總覽統計
     */
    router.get('/overview', (req, res) => {
        try {
            // 今日統計
            const today = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed,
                    SUM(CASE WHEN action = 'register' THEN 1 ELSE 0 END) as registered
                FROM operation_logs
                WHERE DATE(created_at) = DATE('now', 'localtime')
            `).get();

            // 本週統計
            const week = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed
                FROM operation_logs
                WHERE DATE(created_at) >= DATE('now', 'localtime', '-7 days')
            `).get();

            // 計算售出率
            const todaySellRate = today.sold + today.disposed > 0 
                ? Math.round(today.sold / (today.sold + today.disposed) * 100) 
                : 0;
            const weekSellRate = week.sold + week.disposed > 0 
                ? Math.round(week.sold / (week.sold + week.disposed) * 100) 
                : 0;

            // 待處理商品數（目前在庫且即將到期）
            const pending = db.prepare(`
                SELECT COUNT(*) as count
                FROM inventory
                WHERE status = 'in_stock'
                AND datetime(expiry_date) <= datetime('now', 'localtime', '+24 hours')
            `).get();

            res.json({
                today: {
                    ...today,
                    sellRate: todaySellRate
                },
                week: {
                    ...week,
                    sellRate: weekSellRate
                },
                pending: pending.count
            });
        } catch (error) {
            console.error('取得報表總覽失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/reports/staff
     * 取得店員操作統計
     */
    router.get('/staff', (req, res) => {
        try {
            const { period = 'week' } = req.query;
            
            let dateFilter = "DATE(created_at) >= DATE('now', 'localtime', '-7 days')";
            if (period === 'today') {
                dateFilter = "DATE(created_at) = DATE('now', 'localtime')";
            } else if (period === 'month') {
                dateFilter = "DATE(created_at) >= DATE('now', 'localtime', '-30 days')";
            }

            const stats = db.prepare(`
                SELECT 
                    user_id,
                    user_name,
                    COUNT(*) as total_actions,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold_count,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed_count,
                    SUM(CASE WHEN action = 'register' THEN 1 ELSE 0 END) as register_count,
                    MAX(created_at) as last_action
                FROM operation_logs
                WHERE ${dateFilter}
                GROUP BY user_id
                ORDER BY total_actions DESC
            `).all();

            // 計算每人的處理率
            const result = stats.map(s => ({
                ...s,
                sellRate: s.sold_count + s.disposed_count > 0
                    ? Math.round(s.sold_count / (s.sold_count + s.disposed_count) * 100)
                    : 0
            }));

            res.json(result);
        } catch (error) {
            console.error('取得店員統計失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/reports/logs
     * 取得操作記錄列表
     */
    router.get('/logs', (req, res) => {
        try {
            const { limit = 50, offset = 0, user_id, action } = req.query;
            
            let whereClause = '1=1';
            const params = [];
            
            if (user_id) {
                whereClause += ' AND user_id = ?';
                params.push(user_id);
            }
            if (action) {
                whereClause += ' AND action = ?';
                params.push(action);
            }

            const logs = db.prepare(`
                SELECT 
                    id, user_id, user_name, action, product_name, 
                    details, source, created_at
                FROM operation_logs
                WHERE ${whereClause}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `).all(...params, parseInt(limit), parseInt(offset));

            const total = db.prepare(`
                SELECT COUNT(*) as count FROM operation_logs WHERE ${whereClause}
            `).get(...params);

            res.json({
                logs,
                total: total.count,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('取得操作記錄失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/reports/products
     * 取得商品報廢統計（哪些商品常報廢）
     */
    router.get('/products', (req, res) => {
        try {
            const { period = 'month' } = req.query;
            
            let dateFilter = "DATE(o.created_at) >= DATE('now', 'localtime', '-30 days')";
            if (period === 'week') {
                dateFilter = "DATE(o.created_at) >= DATE('now', 'localtime', '-7 days')";
            }

            const stats = db.prepare(`
                SELECT 
                    o.product_name,
                    COUNT(*) as total,
                    SUM(CASE WHEN o.action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN o.action = 'disposed' THEN 1 ELSE 0 END) as disposed
                FROM operation_logs o
                WHERE ${dateFilter}
                AND o.action IN ('sold', 'disposed')
                AND o.product_name IS NOT NULL
                GROUP BY o.product_name
                ORDER BY disposed DESC, total DESC
                LIMIT 20
            `).all();

            // 標記需要注意的商品（報廢率 > 50%）
            const result = stats.map(s => ({
                ...s,
                sellRate: s.sold + s.disposed > 0 
                    ? Math.round(s.sold / (s.sold + s.disposed) * 100) 
                    : 0,
                needsAttention: s.disposed > s.sold
            }));

            res.json(result);
        } catch (error) {
            console.error('取得商品統計失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/reports/daily
     * 取得每日趨勢
     */
    router.get('/daily', (req, res) => {
        try {
            const { days = 7 } = req.query;

            const stats = db.prepare(`
                SELECT 
                    DATE(created_at) as date,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed,
                    SUM(CASE WHEN action = 'register' THEN 1 ELSE 0 END) as registered
                FROM operation_logs
                WHERE DATE(created_at) >= DATE('now', 'localtime', '-' || ? || ' days')
                GROUP BY DATE(created_at)
                ORDER BY date ASC
            `).all(parseInt(days));

            res.json(stats);
        } catch (error) {
            console.error('取得每日趨勢失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
