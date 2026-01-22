/**
 * 商品 API 路由
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得所有商品
    router.get('/', (req, res) => {
        try {
            const products = db.prepare(`
                SELECT * FROM products ORDER BY created_at DESC
            `).all();
            res.json(products);
        } catch (error) {
            console.error('取得商品列表失敗:', error);
            res.status(500).json({ error: '取得商品列表失敗' });
        }
    });

    // 根據條碼查詢商品
    router.get('/barcode/:barcode', (req, res) => {
        try {
            const product = db.prepare(`
                SELECT * FROM products WHERE barcode = ?
            `).get(req.params.barcode);
            
            if (product) {
                res.json(product);
            } else {
                res.status(404).json({ error: '商品不存在' });
            }
        } catch (error) {
            console.error('查詢商品失敗:', error);
            res.status(500).json({ error: '查詢商品失敗' });
        }
    });

    // 新增商品
    router.post('/', (req, res) => {
        try {
            const { barcode, name, category, storage_temp } = req.body;
            
            if (!barcode || !name) {
                return res.status(400).json({ error: '條碼和商品名稱為必填' });
            }

            // 檢查條碼是否已存在
            const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
            if (existing) {
                return res.json({ 
                    id: existing.id, 
                    isNew: false, 
                    message: '商品已存在' 
                });
            }

            const stmt = db.prepare(`
                INSERT INTO products (barcode, name, category, storage_temp)
                VALUES (?, ?, ?, ?)
            `);
            const result = stmt.run(barcode, name, category || null, storage_temp || 'refrigerated');
            
            res.json({ 
                id: result.lastInsertRowid, 
                isNew: true, 
                message: '✅ 新商品已建檔' 
            });
        } catch (error) {
            console.error('新增商品失敗:', error);
            res.status(500).json({ error: '新增商品失敗' });
        }
    });

    // 更新商品
    router.put('/:id', (req, res) => {
        try {
            const { name, category, storage_temp } = req.body;
            const stmt = db.prepare(`
                UPDATE products 
                SET name = ?, category = ?, storage_temp = ?, updated_at = datetime('now')
                WHERE id = ?
            `);
            stmt.run(name, category, storage_temp, req.params.id);
            res.json({ success: true, message: '商品已更新' });
        } catch (error) {
            console.error('更新商品失敗:', error);
            res.status(500).json({ error: '更新商品失敗' });
        }
    });

    // 刪除商品
    router.delete('/:id', (req, res) => {
        try {
            const stmt = db.prepare('DELETE FROM products WHERE id = ?');
            stmt.run(req.params.id);
            res.json({ success: true, message: '商品已刪除' });
        } catch (error) {
            console.error('刪除商品失敗:', error);
            res.status(500).json({ error: '刪除商品失敗' });
        }
    });

    // 搜尋商品
    router.get('/search/:keyword', (req, res) => {
        try {
            const keyword = `%${req.params.keyword}%`;
            const products = db.prepare(`
                SELECT * FROM products 
                WHERE name LIKE ? OR barcode LIKE ? OR category LIKE ?
                ORDER BY name ASC
            `).all(keyword, keyword, keyword);
            res.json(products);
        } catch (error) {
            console.error('搜尋商品失敗:', error);
            res.status(500).json({ error: '搜尋商品失敗' });
        }
    });

    return router;
};
