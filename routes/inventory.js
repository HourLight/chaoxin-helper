/**
 * 庫存 API 路由 (PostgreSQL 版本)
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得所有在庫商品
    router.get('/', async (req, res) => {
        try {
            const status = req.query.status || 'in_stock';
            const storageTemp = req.query.storage_temp;
            
            let query = `
                SELECT 
                    i.id, i.quantity, i.expiry_date, i.status, i.created_at,
                    p.id as product_id, p.barcode, p.name, p.category, p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = $1
            `;
            const params = [status];
            
            if (storageTemp) {
                query += ' AND p.storage_temp = $2';
                params.push(storageTemp);
            }
            
            query += ' ORDER BY i.expiry_date ASC';
            
            const result = await db.query(query, params);
            
            // 計算效期倒數
            const now = new Date();
            result.rows.forEach(item => {
                const expiryDate = new Date(item.expiry_date);
                const diffTime = expiryDate - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
                
                item.days_until_expiry = diffDays;
                item.hours_until_expiry = diffHours;
                item.is_expiring_soon = diffHours <= 24 && diffHours > 0;
                item.is_expired = diffTime <= 0;
            });
            
            res.json(result.rows);
        } catch (error) {
            console.error('取得庫存列表失敗:', error);
            res.status(500).json({ error: '取得庫存列表失敗' });
        }
    });

    // 新增庫存記錄
    router.post('/', async (req, res) => {
        try {
            const { product_id, barcode, name, category, storage_temp, quantity, expiry_date } = req.body;
            
            if (!expiry_date) {
                return res.status(400).json({ error: '效期為必填' });
            }

            let productId = product_id;

            // 如果沒有 product_id，嘗試用條碼查找或建立新商品
            if (!productId) {
                if (barcode) {
                    const existing = await db.query('SELECT id FROM products WHERE barcode = $1', [barcode]);
                    if (existing.rows.length > 0) {
                        productId = existing.rows[0].id;
                    }
                }
                
                if (!productId && name) {
                    const result = await db.query(
                        'INSERT INTO products (barcode, name, category, storage_temp) VALUES ($1, $2, $3, $4) RETURNING id',
                        [barcode || null, name, category || null, storage_temp || 'refrigerated']
                    );
                    productId = result.rows[0].id;
                }
                
                if (!productId) {
                    return res.status(400).json({ error: '請提供商品名稱' });
                }
            }

            const result = await db.query(
                'INSERT INTO inventory (product_id, quantity, expiry_date, status) VALUES ($1, $2, $3, $4) RETURNING id',
                [productId, quantity || 1, expiry_date, 'in_stock']
            );

            res.json({ id: result.rows[0].id, message: '🎉 商品登記成功！' });
        } catch (error) {
            console.error('新增庫存失敗:', error);
            res.status(500).json({ error: '新增庫存失敗' });
        }
    });

    // 更新庫存狀態
    router.put('/:id/status', async (req, res) => {
        try {
            const { status } = req.body;
            
            if (!['in_stock', 'sold', 'disposed', 'removed'].includes(status)) {
                return res.status(400).json({ error: '無效的狀態' });
            }

            await db.query(
                'UPDATE inventory SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [status, req.params.id]
            );

            const statusText = { 'sold': '已售出', 'disposed': '已報廢', 'removed': '已下架' };
            res.json({ success: true, message: `✅ 商品已標記為「${statusText[status] || status}」` });
        } catch (error) {
            console.error('更新庫存狀態失敗:', error);
            res.status(500).json({ error: '更新狀態失敗' });
        }
    });

    // 更新數量
    router.put('/:id/quantity', async (req, res) => {
        try {
            const { quantity } = req.body;
            if (quantity < 0) return res.status(400).json({ error: '數量不能為負數' });

            await db.query(
                'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [quantity, req.params.id]
            );
            res.json({ success: true, message: '數量已更新' });
        } catch (error) {
            console.error('更新數量失敗:', error);
            res.status(500).json({ error: '更新數量失敗' });
        }
    });

    // 編輯庫存記錄
    router.put('/:id', async (req, res) => {
        try {
            const { quantity, expiry_date, name, category, storage_temp } = req.body;
            const inventoryId = req.params.id;
            
            const existingResult = await db.query(`
                SELECT i.*, p.id as product_id, p.name, p.category, p.storage_temp
                FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.id = $1
            `, [inventoryId]);
            
            if (existingResult.rows.length === 0) {
                return res.status(404).json({ error: '找不到這筆庫存記錄' });
            }
            const existing = existingResult.rows[0];

            if (quantity !== undefined || expiry_date) {
                await db.query(`
                    UPDATE inventory SET quantity = COALESCE($1, quantity), expiry_date = COALESCE($2, expiry_date), updated_at = CURRENT_TIMESTAMP WHERE id = $3
                `, [quantity !== undefined ? quantity : null, expiry_date || null, inventoryId]);
            }

            if (name || category !== undefined || storage_temp) {
                await db.query(`
                    UPDATE products SET name = COALESCE($1, name), category = COALESCE($2, category), storage_temp = COALESCE($3, storage_temp), updated_at = CURRENT_TIMESTAMP WHERE id = $4
                `, [name || null, category !== undefined ? category : null, storage_temp || null, existing.product_id]);
            }

            res.json({ success: true, message: '✅ 庫存資料已更新！' });
        } catch (error) {
            console.error('編輯庫存失敗:', error);
            res.status(500).json({ error: '編輯失敗：' + error.message });
        }
    });

    // 取得單一庫存記錄
    router.get('/:id', async (req, res) => {
        try {
            const result = await db.query(`
                SELECT i.id, i.quantity, i.expiry_date, i.status, i.created_at,
                       p.id as product_id, p.barcode, p.name, p.category, p.storage_temp
                FROM inventory i JOIN products p ON i.product_id = p.id WHERE i.id = $1
            `, [req.params.id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: '找不到這筆庫存記錄' });
            }
            res.json(result.rows[0]);
        } catch (error) {
            console.error('取得庫存記錄失敗:', error);
            res.status(500).json({ error: '取得記錄失敗' });
        }
    });

    // 刪除庫存記錄
    router.delete('/:id', async (req, res) => {
        try {
            await db.query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
            res.json({ success: true, message: '記錄已刪除' });
        } catch (error) {
            console.error('刪除庫存失敗:', error);
            res.status(500).json({ error: '刪除失敗' });
        }
    });

    // 批次標記下架
    router.post('/batch-remove', async (req, res) => {
        try {
            const { ids } = req.body;
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: '請提供要下架的商品 ID' });
            }

            const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
            await db.query(
                `UPDATE inventory SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
                ids
            );

            res.json({ success: true, message: `✅ 已標記 ${ids.length} 個商品為「已下架」` });
        } catch (error) {
            console.error('批次下架失敗:', error);
            res.status(500).json({ error: '批次下架失敗' });
        }
    });

    return router;
};
