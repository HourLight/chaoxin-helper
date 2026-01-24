/**
 * 條碼資料庫查詢服務
 * 整合多個外部資料庫：Open Food Facts、UPCitemdb
 * 
 * 查詢策略：
 * 1. 先查本地資料庫（最快）
 * 2. 再查 Open Food Facts（免費無限制）
 * 3. 再查 UPCitemdb（免費 100次/天）
 * 4. 都沒有就回傳 null，讓 AI 辨識接手
 */

const https = require('https');

/**
 * 查詢 Open Food Facts（免費、無限制）
 * @param {string} barcode - 商品條碼
 * @returns {Promise<Object|null>} 商品資訊或 null
 */
async function lookupOpenFoodFacts(barcode) {
    return new Promise((resolve) => {
        const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
        
        const options = {
            hostname: 'world.openfoodfacts.org',
            port: 443,
            path: `/api/v2/product/${barcode}.json`,
            method: 'GET',
            headers: {
                'User-Agent': 'ChaoxinHelper/2.0 (convenience store expiry management; contact: hourlight.tw)'
            },
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    
                    if (response.status !== 1 || !response.product) {
                        console.log(`[Open Food Facts] 找不到商品: ${barcode}`);
                        resolve(null);
                        return;
                    }

                    const product = response.product;
                    
                    // 整理商品名稱（優先中文）
                    let name = product.product_name_zh || 
                               product.product_name_zh_tw ||
                               product.product_name ||
                               product.product_name_en ||
                               null;
                    
                    // 如果名稱太長，截斷
                    if (name && name.length > 50) {
                        name = name.substring(0, 50);
                    }

                    if (!name) {
                        console.log(`[Open Food Facts] 商品無名稱: ${barcode}`);
                        resolve(null);
                        return;
                    }

                    const result = {
                        source: 'open_food_facts',
                        barcode: barcode,
                        name: name,
                        brand: product.brands || null,
                        category: mapCategory(product.categories_tags || []),
                        storage_temp: guessStorageTemp(product),
                        image_url: product.image_url || product.image_front_url || null,
                        extra: {
                            quantity: product.quantity || null,
                            nutriscore: product.nutriscore_grade || null,
                            countries: product.countries || null
                        }
                    };

                    console.log(`[Open Food Facts] ✅ 找到商品: ${result.name}`);
                    resolve(result);
                    
                } catch (error) {
                    console.error(`[Open Food Facts] 解析錯誤:`, error.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[Open Food Facts] 連線錯誤:`, error.message);
            resolve(null);
        });

        req.on('timeout', () => {
            console.log(`[Open Food Facts] 連線逾時`);
            req.destroy();
            resolve(null);
        });

        req.end();
    });
}

/**
 * 查詢 UPCitemdb（免費 100次/天）
 * @param {string} barcode - 商品條碼
 * @returns {Promise<Object|null>} 商品資訊或 null
 */
async function lookupUPCitemdb(barcode) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.upcitemdb.com',
            port: 443,
            path: `/prod/trial/lookup?upc=${barcode}`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            // 檢查剩餘配額
            const remaining = res.headers['x-ratelimit-remaining'];
            if (remaining) {
                console.log(`[UPCitemdb] 今日剩餘查詢次數: ${remaining}`);
            }

            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    
                    if (response.code !== 'OK' || !response.items || response.items.length === 0) {
                        console.log(`[UPCitemdb] 找不到商品: ${barcode}`);
                        resolve(null);
                        return;
                    }

                    const item = response.items[0];
                    
                    let name = item.title || null;
                    if (name && name.length > 50) {
                        name = name.substring(0, 50);
                    }

                    if (!name) {
                        resolve(null);
                        return;
                    }

                    const result = {
                        source: 'upcitemdb',
                        barcode: barcode,
                        name: name,
                        brand: item.brand || null,
                        category: item.category ? mapCategoryFromString(item.category) : null,
                        storage_temp: 'refrigerated', // UPCitemdb 沒有溫度資訊，預設冷藏
                        image_url: (item.images && item.images.length > 0) ? item.images[0] : null,
                        extra: {
                            description: item.description || null,
                            weight: item.weight || null
                        }
                    };

                    console.log(`[UPCitemdb] ✅ 找到商品: ${result.name}`);
                    resolve(result);
                    
                } catch (error) {
                    console.error(`[UPCitemdb] 解析錯誤:`, error.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[UPCitemdb] 連線錯誤:`, error.message);
            resolve(null);
        });

        req.on('timeout', () => {
            console.log(`[UPCitemdb] 連線逾時`);
            req.destroy();
            resolve(null);
        });

        req.end();
    });
}

/**
 * 從 Open Food Facts 類別標籤對應到我們的類別
 */
function mapCategory(categoryTags) {
    if (!categoryTags || categoryTags.length === 0) return null;
    
    const tagString = categoryTags.join(' ').toLowerCase();
    
    if (tagString.includes('dairy') || tagString.includes('milk') || tagString.includes('yogurt') || tagString.includes('cheese')) {
        return '乳製品';
    }
    if (tagString.includes('salad') || tagString.includes('vegetable')) {
        return '沙拉';
    }
    if (tagString.includes('sandwich') || tagString.includes('bread')) {
        return '三明治';
    }
    if (tagString.includes('bakery') || tagString.includes('pastry') || tagString.includes('cake')) {
        return '麵包';
    }
    if (tagString.includes('beverage') || tagString.includes('drink') || tagString.includes('juice') || tagString.includes('tea') || tagString.includes('coffee')) {
        return '飲料';
    }
    if (tagString.includes('meal') || tagString.includes('rice') || tagString.includes('bento') || tagString.includes('sushi')) {
        return '便當';
    }
    if (tagString.includes('dessert') || tagString.includes('pudding') || tagString.includes('sweet')) {
        return '甜點';
    }
    
    return '其他';
}

/**
 * 從字串對應類別
 */
function mapCategoryFromString(categoryString) {
    if (!categoryString) return null;
    
    const lower = categoryString.toLowerCase();
    
    if (lower.includes('dairy') || lower.includes('milk')) return '乳製品';
    if (lower.includes('salad')) return '沙拉';
    if (lower.includes('sandwich') || lower.includes('bread')) return '三明治';
    if (lower.includes('bakery')) return '麵包';
    if (lower.includes('beverage') || lower.includes('drink')) return '飲料';
    if (lower.includes('meal') || lower.includes('food')) return '便當';
    if (lower.includes('snack') || lower.includes('dessert')) return '甜點';
    
    return '其他';
}

/**
 * 根據商品資訊猜測儲存溫度
 */
function guessStorageTemp(product) {
    const tags = (product.categories_tags || []).join(' ').toLowerCase();
    const name = (product.product_name || '').toLowerCase();
    
    // 冷凍
    if (tags.includes('frozen') || name.includes('frozen') || name.includes('ice cream')) {
        return 'frozen';
    }
    
    // 常溫
    if (tags.includes('canned') || tags.includes('snack') || tags.includes('chips') || 
        tags.includes('biscuit') || tags.includes('cookie') || tags.includes('noodle')) {
        return 'room_temp';
    }
    
    // 預設冷藏（便利商店大部分鮮食都是冷藏）
    return 'refrigerated';
}

/**
 * 主要查詢函數 - 依序嘗試各個資料庫
 * @param {string} barcode - 商品條碼
 * @param {Object} db - SQLite 資料庫實例（可選）
 * @returns {Promise<Object|null>} 商品資訊或 null
 */
async function lookupBarcode(barcode, db = null) {
    console.log(`\n🔍 開始查詢條碼: ${barcode}`);
    
    // 清理條碼（移除空白和特殊字元）
    barcode = String(barcode).trim().replace(/[^0-9]/g, '');
    
    if (!barcode || barcode.length < 8) {
        console.log(`❌ 無效的條碼格式: ${barcode}`);
        return null;
    }
    
    // 1️⃣ 先查本地資料庫
    if (db) {
        try {
            const localProduct = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
            if (localProduct) {
                console.log(`[本地資料庫] ✅ 找到商品: ${localProduct.name}`);
                return {
                    source: 'local',
                    barcode: barcode,
                    name: localProduct.name,
                    brand: null,
                    category: localProduct.category,
                    storage_temp: localProduct.storage_temp,
                    image_url: null,
                    product_id: localProduct.id,
                    extra: {}
                };
            }
            console.log(`[本地資料庫] 沒有此商品`);
        } catch (error) {
            console.error(`[本地資料庫] 查詢錯誤:`, error.message);
        }
    }
    
    // 2️⃣ 查詢 Open Food Facts（免費無限制）
    const offResult = await lookupOpenFoodFacts(barcode);
    if (offResult) {
        return offResult;
    }
    
    // 3️⃣ 查詢 UPCitemdb（免費 100次/天）
    const upcResult = await lookupUPCitemdb(barcode);
    if (upcResult) {
        return upcResult;
    }
    
    // 4️⃣ 都找不到
    console.log(`❌ 所有資料庫都找不到條碼: ${barcode}`);
    return null;
}

/**
 * 批次查詢（未來擴充用）
 */
async function lookupBarcodes(barcodes, db = null) {
    const results = [];
    for (const barcode of barcodes) {
        const result = await lookupBarcode(barcode, db);
        results.push({
            barcode: barcode,
            found: !!result,
            data: result
        });
        // 避免請求太快被擋
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return results;
}

module.exports = {
    lookupBarcode,
    lookupBarcodes,
    lookupOpenFoodFacts,
    lookupUPCitemdb
};
