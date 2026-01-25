/**
 * 商品 API 路由 (PostgreSQL 版本)
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得所有商品
    router.get('/', async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM products ORDER BY created_at DESC');
            res.json(result.rows);
        } catch (error) {
            console.error('取得商品列表失敗:', error);
            res.status(500).json({ error: '取得商品列表失敗' });
        }
    });

    // 根據條碼查詢商品
    router.get('/barcode/:barcode', async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM products WHERE barcode = $1', [req.params.barcode]);
            if (result.rows.length > 0) {
                res.json(result.rows[0]);
            } else {
                res.status(404).json({ error: '商品不存在' });
            }
        } catch (error) {
            console.error('查詢商品失敗:', error);
            res.status(500).json({ error: '查詢商品失敗' });
        }
    });

    // 新增商品
    router.post('/', async (req, res) => {
        try {
            const { barcode, name, category, storage_temp } = req.body;
            
            if (!barcode || !name) {
                return res.status(400).json({ error: '條碼和商品名稱為必填' });
            }

            // 檢查條碼是否已存在
            const existing = await db.query('SELECT id FROM products WHERE barcode = $1', [barcode]);
            if (existing.rows.length > 0) {
                return res.json({ 
                    id: existing.rows[0].id, 
                    isNew: false, 
                    message: '商品已存在' 
                });
            }

            const result = await db.query(
                'INSERT INTO products (barcode, name, category, storage_temp) VALUES ($1, $2, $3, $4) RETURNING id',
                [barcode, name, category || null, storage_temp || 'refrigerated']
            );
            
            res.json({ 
                id: result.rows[0].id, 
                isNew: true, 
                message: '✅ 新商品已建檔' 
            });
        } catch (error) {
            console.error('新增商品失敗:', error);
            res.status(500).json({ error: '新增商品失敗' });
        }
    });

    // 更新商品
    router.put('/:id', async (req, res) => {
        try {
            const { name, category, storage_temp } = req.body;
            await db.query(
                'UPDATE products SET name = $1, category = $2, storage_temp = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
                [name, category, storage_temp, req.params.id]
            );
            res.json({ success: true, message: '商品已更新' });
        } catch (error) {
            console.error('更新商品失敗:', error);
            res.status(500).json({ error: '更新商品失敗' });
        }
    });

    // 刪除商品
    router.delete('/:id', async (req, res) => {
        try {
            await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
            res.json({ success: true, message: '商品已刪除' });
        } catch (error) {
            console.error('刪除商品失敗:', error);
            res.status(500).json({ error: '刪除商品失敗' });
        }
    });

    // 搜尋商品
    router.get('/search/:keyword', async (req, res) => {
        try {
            const keyword = `%${req.params.keyword}%`;
            const result = await db.query(
                'SELECT * FROM products WHERE name ILIKE $1 OR barcode ILIKE $1 OR category ILIKE $1 ORDER BY name ASC',
                [keyword]
            );
            res.json(result.rows);
        } catch (error) {
            console.error('搜尋商品失敗:', error);
            res.status(500).json({ error: '搜尋商品失敗' });
        }
    });

    return router;
};
