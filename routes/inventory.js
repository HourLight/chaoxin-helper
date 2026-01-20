/**
 * 庫存 API 路由
 */

const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // 取得所有在庫商品
    router.get('/', (req, res) => {
        try {
            const status = req.query.status || 'in_stock';
            const storageTemp = req.query.storage_temp;
            
            let query = `
                SELECT 
                    i.id,
                    i.quantity,
                    i.expiry_date,
                    i.status,
                    i.created_at,
                    p.id as product_id,
                    p.barcode,
                    p.name,
                    p.category,
                    p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.status = ?
            `;
            
            const params = [status];
            
            if (storageTemp) {
                query += ' AND p.storage_temp = ?';
                params.push(storageTemp);
            }
            
            query += ' ORDER BY i.expiry_date ASC';
            
            const items = db.prepare(query).all(...params);
            
            // 計算效期倒數
            const now = new Date();
            items.forEach(item => {
                const expiryDate = new Date(item.expiry_date);
                const diffTime = expiryDate - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
                
                item.days_until_expiry = diffDays;
                item.hours_until_expiry = diffHours;
                item.is_expiring_soon = diffHours <= 24 && diffHours > 0;
                item.is_expired = diffTime <= 0;
            });
            
            res.json(items);
        } catch (error) {
            console.error('取得庫存列表失敗:', error);
            res.status(500).json({ error: '取得庫存列表失敗' });
        }
    });

    // 新增庫存記錄
    router.post('/', (req, res) => {
        try {
            const { product_id, barcode, name, category, storage_temp, quantity, expiry_date } = req.body;
            
            if (!expiry_date) {
                return res.status(400).json({ error: '效期為必填' });
            }

            let productId = product_id;

            // 如果沒有 product_id，嘗試用條碼查找或建立新商品
            if (!productId && barcode) {
                const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
                
                if (existing) {
                    productId = existing.id;
                } else if (name) {
                    // 建立新商品
                    const stmt = db.prepare(`
                        INSERT INTO products (barcode, name, category, storage_temp)
                        VALUES (?, ?, ?, ?)
                    `);
                    const result = stmt.run(barcode, name, category || null, storage_temp || 'refrigerated');
                    productId = result.lastInsertRowid;
                } else {
                    return res.status(400).json({ error: '找不到商品，請提供商品名稱' });
                }
            }

            if (!productId) {
                return res.status(400).json({ error: '請提供商品資訊' });
            }

            // 新增庫存記錄
            const stmt = db.prepare(`
                INSERT INTO inventory (product_id, quantity, expiry_date, status)
                VALUES (?, ?, ?, 'in_stock')
            `);
            const result = stmt.run(productId, quantity || 1, expiry_date);

            res.json({ 
                id: result.lastInsertRowid, 
                message: '🎉 商品登記成功！' 
            });
        } catch (error) {
            console.error('新增庫存失敗:', error);
            res.status(500).json({ error: '新增庫存失敗' });
        }
    });

    // 更新庫存狀態（標記已售出/已報廢）
    router.put('/:id/status', (req, res) => {
        try {
            const { status } = req.body;
            
            if (!['in_stock', 'sold', 'disposed', 'removed'].includes(status)) {
                return res.status(400).json({ error: '無效的狀態' });
            }

            const stmt = db.prepare(`
                UPDATE inventory 
                SET status = ?, updated_at = datetime('now')
                WHERE id = ?
            `);
            stmt.run(status, req.params.id);

            const statusText = {
                'sold': '已售出',
                'disposed': '已報廢',
                'removed': '已下架'
            };

            res.json({ 
                success: true, 
                message: `✅ 商品已標記為「${statusText[status] || status}」` 
            });
        } catch (error) {
            console.error('更新庫存狀態失敗:', error);
            res.status(500).json({ error: '更新狀態失敗' });
        }
    });

    // 更新庫存數量
    router.put('/:id/quantity', (req, res) => {
        try {
            const { quantity } = req.body;
            
            if (quantity < 0) {
                return res.status(400).json({ error: '數量不能為負數' });
            }

            const stmt = db.prepare(`
                UPDATE inventory 
                SET quantity = ?, updated_at = datetime('now')
                WHERE id = ?
            `);
            stmt.run(quantity, req.params.id);

            res.json({ success: true, message: '數量已更新' });
        } catch (error) {
            console.error('更新數量失敗:', error);
            res.status(500).json({ error: '更新數量失敗' });
        }
    });

    // 刪除庫存記錄
    router.delete('/:id', (req, res) => {
        try {
            const stmt = db.prepare('DELETE FROM inventory WHERE id = ?');
            stmt.run(req.params.id);
            res.json({ success: true, message: '記錄已刪除' });
        } catch (error) {
            console.error('刪除庫存失敗:', error);
            res.status(500).json({ error: '刪除失敗' });
        }
    });

    // 批次標記下架（給 LINE Bot 用）
    router.post('/batch-remove', (req, res) => {
        try {
            const { ids } = req.body;
            
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: '請提供要下架的商品 ID' });
            }

            const placeholders = ids.map(() => '?').join(',');
            const stmt = db.prepare(`
                UPDATE inventory 
                SET status = 'removed', updated_at = datetime('now')
                WHERE id IN (${placeholders})
            `);
            stmt.run(...ids);

            res.json({ 
                success: true, 
                message: `✅ 已標記 ${ids.length} 個商品為「已下架」` 
            });
        } catch (error) {
            console.error('批次下架失敗:', error);
            res.status(500).json({ error: '批次下架失敗' });
        }
    });

    return router;
};
