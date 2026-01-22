/**
 * AI 辨識服務 - 強化版
 * 使用 Anthropic Claude API 進行商品辨識
 * 支援一拍到底、高精準度辨識
 */

const https = require('https');
const axios = require('axios');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * 呼叫 Claude API 進行圖片辨識
 */
async function callClaudeAPI(base64Image, mimeType) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mimeType,
                            data: base64Image
                        }
                    },
                    {
                        type: 'text',
                        text: `你是便利商店商品辨識專家。請仔細分析這張商品照片，精準辨識以下資訊：

## 辨識項目

### 1. 商品條碼
- 尋找 EAN-13（13位數）、EAN-8（8位數）、UPC-A（12位數）格式
- 條碼通常在包裝底部或背面
- 注意區分條碼和其他數字（如製造日期編號）

### 2. 商品名稱
- 找出包裝上最顯眼的品名
- 包含品牌名稱 + 產品名稱
- 例如：「光泉鮮乳」「義美小泡芙」「統一布丁」

### 3. 有效期限（重要！）
尋找以下關鍵字後面的日期：
- 「有效期限」「有效日期」「EXP」「EXP.」「EXPIRY」
- 「賞味期限」「賞味期間」「BEST BEFORE」「BB」
- 「保存期限」「保鮮期限」
- 「有效」「效期」

日期格式可能是：
- 2026/01/20、2026.01.20、2026-01-20
- 26/01/20、26.01.20
- 20260120（無分隔符）
- JAN 20 2026、20 JAN 2026

### 4. 商品類別判斷
根據包裝特徵判斷：
- 乳製品：鮮乳、優酪乳、優格、起司、奶酪
- 沙拉：生菜沙拉、水果沙拉、雞肉沙拉
- 三明治：各種三明治、漢堡、捲餅
- 麵包：吐司、餐包、甜麵包、蛋糕
- 便當：飯糰、便當、壽司、涼麵
- 飲料：果汁、茶飲、咖啡、豆漿
- 甜點：布丁、蛋糕、甜點杯
- 其他：無法分類的商品

### 5. 儲存溫度判斷
- refrigerated（冷藏 0-7°C）：大部分生鮮品
- frozen（冷凍 -18°C）：冰淇淋、冷凍食品
- room_temp（常溫）：餅乾、泡麵、罐頭

## 回覆格式

請以 JSON 格式回覆，格式如下：
{
  "barcode": {
    "value": "條碼數字字串或 null",
    "confidence": 0-100,
    "position": "條碼在圖片中的位置描述（如：底部中央、右下角）"
  },
  "name": {
    "value": "完整商品名稱或 null",
    "confidence": 0-100,
    "position": "商品名在圖片中的位置描述"
  },
  "expiry_date": {
    "value": "YYYY-MM-DD 格式或 null",
    "confidence": 0-100,
    "original_text": "原始效期文字（如：2026/01/20）",
    "position": "效期在圖片中的位置描述"
  },
  "category": "商品類別",
  "storage_temp": "refrigerated 或 frozen 或 room_temp",
  "notes": "任何需要注意的事項，如照片模糊、部分資訊被遮擋等"
}

## 重要提醒
- 信心度要誠實，看不清楚就給低分
- 條碼必須是完整數字，不確定的數字用低信心度
- 效期日期必須轉換為 YYYY-MM-DD 格式
- 如果完全看不到某項資訊，value 設為 null，confidence 設為 0

只回覆 JSON，不要有其他文字。`
                    }
                ]
            }]
        });

        const options = {
            hostname: 'api.anthropic.com',
            port: 443,
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.content && response.content[0]) {
                        resolve(response.content[0].text);
                    } else {
                        reject(new Error('Invalid API response'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

/**
 * 辨識商品資訊
 */
async function recognizeProduct(base64Image, mimeType) {
    // 如果沒有設定 API Key，使用模擬模式
    if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
        console.log('AI 辨識：使用模擬模式（未設定 API Key）');
        return {
            barcode: { value: null, confidence: 0 },
            name: { value: null, confidence: 0 },
            expiry_date: { value: null, confidence: 0 },
            category: null,
            storage_temp: 'refrigerated',
            mock: true,
            message: '目前為模擬模式，請設定 ANTHROPIC_API_KEY 以啟用 AI 辨識'
        };
    }

    try {
        const responseText = await callClaudeAPI(base64Image, mimeType);
        
        // 清理回應，移除可能的 markdown 格式
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.slice(7);
        }
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.slice(3);
        }
        if (cleanJson.endsWith('```')) {
            cleanJson = cleanJson.slice(0, -3);
        }
        cleanJson = cleanJson.trim();

        const result = JSON.parse(cleanJson);
        
        // 確保回傳格式正確
        return {
            barcode: result.barcode || { value: null, confidence: 0 },
            name: result.name || { value: null, confidence: 0 },
            expiry_date: result.expiry_date || { value: null, confidence: 0 },
            category: result.category || null,
            storage_temp: result.storage_temp || 'refrigerated'
        };
    } catch (error) {
        console.error('AI 辨識錯誤:', error);
        throw error;
    }
}

/**
 * 從 LINE 訊息 ID 取得圖片並辨識
 * @param {string} messageId - LINE 訊息 ID
 * @returns {Promise<Object>} 辨識結果
 */
async function recognizeFromLineImage(messageId) {
    const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
        throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定');
    }

    try {
        // 從 LINE 取得圖片
        const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            },
            responseType: 'arraybuffer'
        });

        // 轉換為 base64
        const base64Image = Buffer.from(response.data).toString('base64');
        
        // 判斷圖片類型（LINE 通常是 JPEG）
        const mimeType = response.headers['content-type'] || 'image/jpeg';

        // 進行辨識
        return await recognizeProduct(base64Image, mimeType);
    } catch (error) {
        console.error('LINE 圖片辨識失敗:', error);
        throw error;
    }
}

/**
 * 取得信心度等級
 */
function getConfidenceLevel(confidence) {
    if (confidence >= 80) {
        return { level: 'high', icon: '✅', text: '高信心度' };
    } else if (confidence >= 50) {
        return { level: 'medium', icon: '⚠️', text: '中信心度' };
    } else {
        return { level: 'low', icon: '❌', text: '低信心度' };
    }
}

module.exports = {
    recognizeProduct,
    recognizeFromLineImage,
    getConfidenceLevel
};
