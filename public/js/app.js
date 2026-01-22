/**
 * 潮欣小幫手 - 前端主要 JavaScript
 */

// ===== 全域工具函數 =====

/**
 * 顯示 Toast 訊息
 */
function showToast(message, type = 'default') {
    // 移除現有的 toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * 顯示確認對話框
 */
function showConfirm(title, message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="modal-actions">
                    <button class="btn btn-secondary" data-action="cancel">取消</button>
                    <button class="btn btn-primary" data-action="confirm">確認</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        setTimeout(() => overlay.classList.add('show'), 10);

        overlay.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'confirm') {
                resolve(true);
            } else if (action === 'cancel' || e.target === overlay) {
                resolve(false);
            }
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 300);
        });
    });
}

/**
 * 顯示載入中
 */
function showLoading(container, text = 'Loading...') {
    container.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">${text}</div>
        </div>
    `;
}

/**
 * 顯示空狀態
 */
function showEmpty(container, icon, title, description) {
    container.innerHTML = `
        <div class="empty-state">
            <div class="icon">${icon}</div>
            <h3>${title}</h3>
            <p>${description}</p>
        </div>
    `;
}

/**
 * API 請求封裝
 */
async function api(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const response = await fetch(`/api${endpoint}`, {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '請求失敗' }));
        throw new Error(error.error || '請求失敗');
    }

    return response.json();
}

/**
 * 格式化日期
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

/**
 * 格式化日期時間
 */
function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 計算效期倒數
 */
function getExpiryCountdown(expiryDate) {
    const now = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffTime / (1000 * 60 * 60));

    if (diffTime <= 0) {
        return {
            text: `已過期 ${Math.abs(diffDays)} 天`,
            class: 'expired',
            urgent: true
        };
    } else if (diffHours <= 24) {
        return {
            text: `還有 ${diffHours} 小時到期`,
            class: 'expiring-soon',
            urgent: true
        };
    } else if (diffDays <= 3) {
        return {
            text: `還有 ${diffDays} 天到期`,
            class: 'expiring-soon',
            urgent: false
        };
    } else {
        return {
            text: `還有 ${diffDays} 天到期`,
            class: '',
            urgent: false
        };
    }
}

/**
 * 取得溫度顯示
 */
function getTempDisplay(storageTemp) {
    const temps = {
        'refrigerated': { icon: '❄️', text: '冷藏', class: 'refrigerated' },
        'frozen': { icon: '🧊', text: '冷凍', class: 'frozen' },
        'room_temp': { icon: '🌡️', text: '常溫', class: 'room-temp' }
    };
    return temps[storageTemp] || temps['refrigerated'];
}

/**
 * 取得信心度顯示
 */
function getConfidenceDisplay(confidence) {
    if (confidence >= 80) {
        return { text: '✅ 高信心度', class: 'confidence-high' };
    } else if (confidence >= 50) {
        return { text: '⚠️ 中信心度', class: 'confidence-medium' };
    } else {
        return { text: '❌ 低信心度', class: 'confidence-low' };
    }
}

/**
 * 壓縮圖片
 */
function compressImage(file, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(resolve, 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * 檔案轉 Base64
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ===== 首頁功能 =====

/**
 * 載入儀表板資料
 */
async function loadDashboard() {
    try {
        const data = await api('/dashboard');
        
        // 更新效期提醒卡片
        const alertCard = document.getElementById('alertCard');
        if (alertCard) {
            if (data.expiring > 0 || data.expired > 0) {
                const totalUrgent = data.expiring + data.expired;
                alertCard.classList.remove('hidden');
                alertCard.innerHTML = `
                    <div class="alert-icon">⚠️</div>
                    <div class="alert-content">
                        <h3>今天有 ${totalUrgent} 個商品需要處理</h3>
                        <p>${data.expired > 0 ? `${data.expired} 個已過期、` : ''}${data.expiring > 0 ? `${data.expiring} 個即將到期` : ''}</p>
                    </div>
                `;
            } else {
                alertCard.classList.add('hidden');
            }
        }

        // 更新統計數字
        const statsEl = document.getElementById('stats');
        if (statsEl) {
            statsEl.innerHTML = `
                <span>📦 庫存 ${data.total} 件</span>
                <span>📝 今日登記 ${data.today} 件</span>
            `;
        }
    } catch (error) {
        console.error('載入儀表板失敗:', error);
    }
}

// ===== 庫存管理功能 =====

/**
 * 載入庫存列表
 */
async function loadInventory(container, filter = {}) {
    showLoading(container, '載入中...');

    try {
        const queryParams = new URLSearchParams(filter).toString();
        const items = await api(`/inventory?${queryParams}`);

        if (items.length === 0) {
            showEmpty(container, '📦', '目前沒有庫存', '快去登記一些商品吧！');
            return;
        }

        container.innerHTML = items.map(item => createInventoryCard(item)).join('');
        
        // 綁定按鈕事件
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', handleInventoryAction);
        });
    } catch (error) {
        console.error('載入庫存失敗:', error);
        showEmpty(container, '❌', '載入失敗', error.message);
    }
}

/**
 * 建立庫存卡片 HTML
 */
function createInventoryCard(item) {
    const countdown = getExpiryCountdown(item.expiry_date);
    const temp = getTempDisplay(item.storage_temp);

    return `
        <div class="inventory-card ${countdown.class}">
            <div class="product-name">${item.name}</div>
            <div class="product-info">
                <span>🏷️ ${item.barcode || '無條碼'}</span>
                <span class="temp-badge ${temp.class}">${temp.icon} ${temp.text}</span>
                <span>📅 ${formatDate(item.expiry_date)}</span>
                <span>📦 ${item.quantity} 個</span>
            </div>
            <div class="expiry-countdown ${countdown.urgent ? 'urgent' : ''}">
                ${countdown.text}
            </div>
            <div class="actions">
                <button class="btn btn-outline btn-sm" data-action="sold" data-id="${item.id}">
                    ✅ 已售出
                </button>
                <button class="btn btn-danger btn-sm" data-action="disposed" data-id="${item.id}">
                    🗑️ 已報廢
                </button>
            </div>
        </div>
    `;
}

/**
 * 處理庫存操作
 */
async function handleInventoryAction(e) {
    const action = e.target.dataset.action;
    const id = e.target.dataset.id;

    const actionText = action === 'sold' ? '已售出' : '已報廢';
    const confirmed = await showConfirm(
        '確認操作',
        `確定要將此商品標記為「${actionText}」嗎？`
    );

    if (!confirmed) return;

    try {
        await api(`/inventory/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: action === 'sold' ? 'sold' : 'disposed' })
        });

        showToast(`✅ 商品已標記為「${actionText}」`, 'success');
        
        // 重新載入列表
        const container = document.getElementById('inventoryList');
        if (container) {
            loadInventory(container);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * 發送 LINE 提醒
 */
async function sendLineNotification() {
    const btn = document.getElementById('notifyBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '發送中...';
    }

    try {
        const result = await api('/notify/manual', { method: 'POST' });
        showToast(result.message || '提醒已發送！', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔔 提醒下架';
        }
    }
}

// ===== AI 辨識功能 =====

/**
 * 上傳並辨識圖片
 */
async function recognizeImage(file) {
    const formData = new FormData();
    
    // 壓縮圖片
    const compressedBlob = await compressImage(file);
    formData.append('image', compressedBlob, 'image.jpg');

    const response = await fetch('/api/recognize', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '辨識失敗' }));
        throw new Error(error.error || '辨識失敗');
    }

    return response.json();
}

/**
 * 顯示辨識結果
 */
function displayRecognitionResult(result, container) {
    const barcodeConf = getConfidenceDisplay(result.barcode?.confidence || 0);
    const nameConf = getConfidenceDisplay(result.name?.confidence || 0);
    const expiryConf = getConfidenceDisplay(result.expiry_date?.confidence || 0);

    container.innerHTML = `
        <div class="recognition-result">
            ${result.mock ? `
                <div class="alert-card warning" style="margin-bottom: 16px;">
                    <div class="alert-icon">ℹ️</div>
                    <div class="alert-content">
                        <h3>模擬模式</h3>
                        <p>${result.message || '請設定 API Key 以啟用 AI 辨識'}</p>
                    </div>
                </div>
            ` : ''}
            
            <div class="result-item">
                <label>
                    商品條碼
                    <span class="confidence-badge ${barcodeConf.class}">${barcodeConf.text}</span>
                </label>
                <input type="text" id="resultBarcode" value="${result.barcode?.value || ''}" placeholder="請輸入條碼">
            </div>
            
            <div class="result-item">
                <label>
                    商品名稱
                    <span class="confidence-badge ${nameConf.class}">${nameConf.text}</span>
                </label>
                <input type="text" id="resultName" value="${result.name?.value || ''}" placeholder="請輸入商品名稱" required>
            </div>
            
            <div class="result-item">
                <label>
                    有效期限
                    <span class="confidence-badge ${expiryConf.class}">${expiryConf.text}</span>
                </label>
                <input type="datetime-local" id="resultExpiry" value="${result.expiry_date?.value ? result.expiry_date.value + 'T23:59' : ''}" required>
            </div>
            
            <div class="result-item">
                <label>商品類別</label>
                <select id="resultCategory">
                    <option value="">請選擇</option>
                    <option value="乳製品" ${result.category === '乳製品' ? 'selected' : ''}>乳製品</option>
                    <option value="沙拉" ${result.category === '沙拉' ? 'selected' : ''}>沙拉</option>
                    <option value="三明治" ${result.category === '三明治' ? 'selected' : ''}>三明治</option>
                    <option value="麵包" ${result.category === '麵包' ? 'selected' : ''}>麵包</option>
                    <option value="飲料" ${result.category === '飲料' ? 'selected' : ''}>飲料</option>
                    <option value="其他" ${result.category === '其他' ? 'selected' : ''}>其他</option>
                </select>
            </div>
            
            <div class="result-item">
                <label>儲存溫度</label>
                <select id="resultTemp">
                    <option value="refrigerated" ${result.storage_temp === 'refrigerated' ? 'selected' : ''}>❄️ 冷藏</option>
                    <option value="frozen" ${result.storage_temp === 'frozen' ? 'selected' : ''}>🧊 冷凍</option>
                    <option value="room_temp" ${result.storage_temp === 'room_temp' ? 'selected' : ''}>🌡️ 常溫</option>
                </select>
            </div>
            
            <div class="result-item">
                <label>數量</label>
                <input type="number" id="resultQuantity" value="1" min="1" max="999">
            </div>
        </div>
        
        <button class="btn btn-primary mt-16" id="confirmRegisterBtn">
            ✅ 確認登記
        </button>
        
        <button class="btn btn-secondary mt-16" id="retakeBtn">
            🔄 重新拍攝
        </button>
    `;
}

/**
 * 提交商品登記
 */
async function submitRegistration() {
    const data = {
        barcode: document.getElementById('resultBarcode')?.value || null,
        name: document.getElementById('resultName')?.value,
        category: document.getElementById('resultCategory')?.value || null,
        storage_temp: document.getElementById('resultTemp')?.value || 'refrigerated',
        quantity: parseInt(document.getElementById('resultQuantity')?.value) || 1,
        expiry_date: document.getElementById('resultExpiry')?.value
    };

    if (!data.name) {
        showToast('請輸入商品名稱', 'error');
        return;
    }

    if (!data.expiry_date) {
        showToast('請選擇有效期限', 'error');
        return;
    }

    try {
        const result = await api('/inventory', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        showToast(result.message || '🎉 商品登記成功！', 'success');
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        return false;
    }
}

// ===== 設定頁面功能 =====

/**
 * 載入設定
 */
async function loadSettings() {
    try {
        const settings = await api('/settings');
        return settings;
    } catch (error) {
        console.error('載入設定失敗:', error);
        return {};
    }
}

/**
 * 儲存設定
 */
async function saveSettings(settings) {
    try {
        await api('/settings/batch', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        showToast('✅ 設定已儲存！', 'success');
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        return false;
    }
}

/**
 * 載入 LINE 設定
 */
async function loadLineSettings() {
    try {
        const settings = await api('/line/settings');
        return settings;
    } catch (error) {
        console.error('載入 LINE 設定失敗:', error);
        return {};
    }
}

/**
 * 儲存 LINE 設定
 */
async function saveLineSettings(settings) {
    try {
        await api('/line/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
        showToast('✅ LINE Bot 設定成功！', 'success');
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        return false;
    }
}

/**
 * 測試 LINE Bot
 */
async function testLineBot() {
    try {
        const result = await api('/line/test', { method: 'POST' });
        showToast(`✅ 連線成功！Bot 名稱：${result.botName}`, 'success');
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        return false;
    }
}

/**
 * 發送測試訊息
 */
async function sendTestMessage() {
    try {
        const result = await api('/line/test-message', { method: 'POST' });
        showToast(result.message, 'success');
        return true;
    } catch (error) {
        showToast(error.message, 'error');
        return false;
    }
}

// ===== 條碼掃描功能 =====

/**
 * 初始化條碼輸入監聽
 */
function initBarcodeInput(inputEl, onComplete) {
    let buffer = '';
    let lastKeyTime = Date.now();

    inputEl.addEventListener('keypress', (e) => {
        const currentTime = Date.now();
        
        // 如果超過 100ms，重置 buffer
        if (currentTime - lastKeyTime > 100) {
            buffer = '';
        }
        
        lastKeyTime = currentTime;

        if (e.key === 'Enter') {
            if (buffer.length >= 8) { // 條碼至少 8 位
                onComplete(buffer);
            }
            buffer = '';
            e.preventDefault();
        } else {
            buffer += e.key;
        }
    });
}

/**
 * 查詢條碼對應的商品
 */
async function lookupBarcode(barcode) {
    try {
        const product = await api(`/products/barcode/${barcode}`);
        return product;
    } catch (error) {
        return null; // 商品不存在
    }
}

// ===== 初始化 =====

document.addEventListener('DOMContentLoaded', () => {
    // 首頁初始化
    if (document.getElementById('alertCard')) {
        loadDashboard();
    }
});
