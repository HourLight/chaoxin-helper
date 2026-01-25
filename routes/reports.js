/**
 * 管理員報表 API (PostgreSQL 版本)
 */

const express = require('express');
const router = express.Router();

module.exports = function(db) {
    
    // GET /api/reports/overview - 取得總覽統計
    router.get('/overview', async (req, res) => {
        try {
            const todayResult = await db.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed,
                    SUM(CASE WHEN action = 'register' THEN 1 ELSE 0 END) as registered
                FROM operation_logs
                WHERE DATE(created_at AT TIME ZONE 'Asia/Taipei') = CURRENT_DATE
            `);
            const today = todayResult.rows[0];

            const weekResult = await db.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed
                FROM operation_logs
                WHERE created_at >= NOW() - INTERVAL '7 days'
            `);
            const week = weekResult.rows[0];

            const todaySellRate = parseInt(today.sold) + parseInt(today.disposed) > 0 
                ? Math.round(parseInt(today.sold) / (parseInt(today.sold) + parseInt(today.disposed)) * 100) : 0;
            const weekSellRate = parseInt(week.sold) + parseInt(week.disposed) > 0 
                ? Math.round(parseInt(week.sold) / (parseInt(week.sold) + parseInt(week.disposed)) * 100) : 0;

            const pendingResult = await db.query(`
                SELECT COUNT(*) as count FROM inventory
                WHERE status = 'in_stock' AND expiry_date <= NOW() + INTERVAL '24 hours'
            `);

            res.json({
                today: { ...today, total: parseInt(today.total), sold: parseInt(today.sold), disposed: parseInt(today.disposed), registered: parseInt(today.registered), sellRate: todaySellRate },
                week: { ...week, total: parseInt(week.total), sold: parseInt(week.sold), disposed: parseInt(week.disposed), sellRate: weekSellRate },
                pending: parseInt(pendingResult.rows[0].count)
            });
        } catch (error) {
            console.error('取得報表總覽失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/reports/staff - 取得店員操作統計
    router.get('/staff', async (req, res) => {
        try {
            const { period = 'week' } = req.query;
            let dateFilter = "created_at >= NOW() - INTERVAL '7 days'";
            if (period === 'today') dateFilter = "DATE(created_at AT TIME ZONE 'Asia/Taipei') = CURRENT_DATE";
            else if (period === 'month') dateFilter = "created_at >= NOW() - INTERVAL '30 days'";

            const result = await db.query(`
                SELECT user_id, user_name, COUNT(*) as total_actions,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold_count,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed_count,
                    SUM(CASE WHEN action = 'register' THEN 1 ELSE 0 END) as register_count,
                    MAX(created_at) as last_action
                FROM operation_logs WHERE ${dateFilter}
                GROUP BY user_id, user_name ORDER BY total_actions DESC
            `);

            const stats = result.rows.map(s => ({
                ...s, total_actions: parseInt(s.total_actions), sold_count: parseInt(s.sold_count),
                disposed_count: parseInt(s.disposed_count), register_count: parseInt(s.register_count),
                sellRate: parseInt(s.sold_count) + parseInt(s.disposed_count) > 0
                    ? Math.round(parseInt(s.sold_count) / (parseInt(s.sold_count) + parseInt(s.disposed_count)) * 100) : 0
            }));
            res.json(stats);
        } catch (error) {
            console.error('取得店員統計失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/reports/logs - 取得操作記錄列表
    router.get('/logs', async (req, res) => {
        try {
            const { limit = 50, offset = 0, user_id, action } = req.query;
            let whereClause = '1=1';
            const params = [];
            let paramIndex = 1;
            
            if (user_id) { whereClause += ` AND user_id = $${paramIndex++}`; params.push(user_id); }
            if (action) { whereClause += ` AND action = $${paramIndex++}`; params.push(action); }

            const logsResult = await db.query(`
                SELECT id, user_id, user_name, action, product_name, details, source, created_at
                FROM operation_logs WHERE ${whereClause}
                ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}
            `, [...params, parseInt(limit), parseInt(offset)]);

            const totalResult = await db.query(`SELECT COUNT(*) as count FROM operation_logs WHERE ${whereClause}`, params);

            res.json({
                logs: logsResult.rows,
                total: parseInt(totalResult.rows[0].count),
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        } catch (error) {
            console.error('取得操作記錄失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/reports/products - 取得商品報廢統計
    router.get('/products', async (req, res) => {
        try {
            const { period = 'month' } = req.query;
            let dateFilter = "o.created_at >= NOW() - INTERVAL '30 days'";
            if (period === 'week') dateFilter = "o.created_at >= NOW() - INTERVAL '7 days'";

            const result = await db.query(`
                SELECT o.product_name, COUNT(*) as total,
                    SUM(CASE WHEN o.action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN o.action = 'disposed' THEN 1 ELSE 0 END) as disposed
                FROM operation_logs o
                WHERE ${dateFilter} AND o.action IN ('sold', 'disposed') AND o.product_name IS NOT NULL
                GROUP BY o.product_name ORDER BY disposed DESC, total DESC LIMIT 20
            `);

            const stats = result.rows.map(s => ({
                ...s, total: parseInt(s.total), sold: parseInt(s.sold), disposed: parseInt(s.disposed),
                sellRate: parseInt(s.sold) + parseInt(s.disposed) > 0 
                    ? Math.round(parseInt(s.sold) / (parseInt(s.sold) + parseInt(s.disposed)) * 100) : 0,
                needsAttention: parseInt(s.disposed) > parseInt(s.sold)
            }));
            res.json(stats);
        } catch (error) {
            console.error('取得商品統計失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/reports/daily - 取得每日趨勢
    router.get('/daily', async (req, res) => {
        try {
            const { days = 7 } = req.query;
            const result = await db.query(`
                SELECT DATE(created_at AT TIME ZONE 'Asia/Taipei') as date,
                    SUM(CASE WHEN action = 'sold' THEN 1 ELSE 0 END) as sold,
                    SUM(CASE WHEN action = 'disposed' THEN 1 ELSE 0 END) as disposed,
                    SUM(CASE WHEN action = 'register' THEN 1 ELSE 0 END) as registered
                FROM operation_logs
                WHERE created_at >= NOW() - INTERVAL '1 day' * $1
                GROUP BY DATE(created_at AT TIME ZONE 'Asia/Taipei') ORDER BY date ASC
            `, [parseInt(days)]);

            res.json(result.rows.map(r => ({
                ...r, sold: parseInt(r.sold), disposed: parseInt(r.disposed), registered: parseInt(r.registered)
            })));
        } catch (error) {
            console.error('取得每日趨勢失敗:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
