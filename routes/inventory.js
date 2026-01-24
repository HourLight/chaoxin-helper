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
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            items.forEach(item => {
                const expiryDate = new Date(item.expiry_date);
                const expiryDay = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
                
                // 用日期比較計算天數差（不是小時差）
                const diffDays = Math.round((expiryDay - today) / (1000 * 60 * 60 * 24));
                
                // 小時差還是用原本的方式（精確計算）
                const diffTime = expiryDate - now;
                const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));
                
                item.days_until_expiry = diffDays;
                item.hours_until_expiry = diffHours;
                item.is_expiring_soon = diffDays === 0 || (diffDays === 1 && diffHours <= 24);
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
            if (!productId) {
                // 有條碼就先用條碼查
                if (barcode) {
                    const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
                    if (existing) {
                        productId = existing.id;
                    }
                }
                
                // 還是沒找到商品，且有名稱，就建立新商品
                if (!productId && name) {
                    const stmt = db.prepare(`
                        INSERT INTO products (barcode, name, category, storage_temp)
                        VALUES (?, ?, ?, ?)
                    `);
                    // barcode 可以是 null（AI 沒辨識到條碼的情況）
                    const result = stmt.run(barcode || null, name, category || null, storage_temp || 'refrigerated');
                    productId = result.lastInsertRowid;
                }
                
                // 如果還是沒有 productId，表示缺少必要資訊
                if (!productId) {
                    return res.status(400).json({ error: '請提供商品名稱' });
                }
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

    // 更新數量
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

    // ===== 編輯庫存記錄（完整編輯） =====
    router.put('/:id', (req, res) => {
        try {
            const { quantity, expiry_date, name, category, storage_temp } = req.body;
            const inventoryId = req.params.id;
            
            // 取得現有庫存記錄
            const existing = db.prepare(`
                SELECT i.*, p.id as product_id, p.name, p.category, p.storage_temp
                FROM inventory i
                JOIN products p ON i.product_id = p.id
                WHERE i.id = ?
            `).get(inventoryId);
            
            if (!existing) {
                return res.status(404).json({ error: '找不到這筆庫存記錄' });
            }

            // 更新庫存記錄
            if (quantity !== undefined || expiry_date) {
                const invStmt = db.prepare(`
                    UPDATE inventory 
                    SET quantity = COALESCE(?, quantity),
                        expiry_date = COALESCE(?, expiry_date),
                        updated_at = datetime('now')
                    WHERE id = ?
                `);
                invStmt.run(
                    quantity !== undefined ? quantity : null,
                    expiry_date || null,
                    inventoryId
                );
            }

            // 更新商品資訊
            if (name || category !== undefined || storage_temp) {
                const prodStmt = db.prepare(`
                    UPDATE products 
                    SET name = COALESCE(?, name),
                        category = COALESCE(?, category),
                        storage_temp = COALESCE(?, storage_temp),
                        updated_at = datetime('now')
                    WHERE id = ?
                `);
                prodStmt.run(
                    name || null,
                    category !== undefined ? category : null,
                    storage_temp || null,
                    existing.product_id
                );
            }

            res.json({ 
                success: true, 
                message: '✅ 庫存資料已更新！' 
            });
        } catch (error) {
            console.error('編輯庫存失敗:', error);
            res.status(500).json({ error: '編輯失敗：' + error.message });
        }
    });

    // 取得單一庫存記錄（給編輯用）
    router.get('/:id', (req, res) => {
        try {
            const item = db.prepare(`
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
                WHERE i.id = ?
            `).get(req.params.id);
            
            if (!item) {
                return res.status(404).json({ error: '找不到這筆庫存記錄' });
            }
            
            res.json(item);
        } catch (error) {
            console.error('取得庫存記錄失敗:', error);
            res.status(500).json({ error: '取得記錄失敗' });
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
