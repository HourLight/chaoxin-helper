-- 潮欣小幫手 資料庫結構
-- SQLite3

-- 使用者表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 商品表
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    storage_temp TEXT DEFAULT 'refrigerated' CHECK(storage_temp IN ('refrigerated', 'frozen', 'room_temp')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 庫存記錄表
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    expiry_date DATETIME NOT NULL,
    status TEXT DEFAULT 'in_stock' CHECK(status IN ('in_stock', 'sold', 'disposed', 'removed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 通知設定表
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- LINE Bot 設定表
CREATE TABLE IF NOT EXISTS line_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_secret TEXT,
    channel_access_token TEXT,
    group_id TEXT,
    is_active INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 通知記錄表
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_id INTEGER,
    message TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'acknowledged')),
    FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- 插入預設設定
INSERT OR IGNORE INTO settings (key, value) VALUES ('notification_hours_before', '24');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notification_enabled', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notification_cron_time', '0 9 * * *');

-- 插入預設管理員
INSERT OR IGNORE INTO users (name, email, role) VALUES ('管理員', 'admin@chaoxin.local', 'admin');

-- ============================================
-- 潮欣小幫手 2.0 - 遊戲化系統資料表
-- ============================================

-- 籤卡表（存放 130 張籤卡）
CREATE TABLE IF NOT EXISTS fortune_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_code TEXT UNIQUE NOT NULL,       -- 籤卡編號（A00-A21, 001-108）
    series TEXT NOT NULL,                  -- 系列（A: 職涯外掛篇, 0: 身心補給篇）
    rarity TEXT NOT NULL,                  -- 稀有度（SSR, SR, R, Quest）
    title TEXT NOT NULL,                   -- 主標題
    subtitle TEXT,                         -- 副標題
    scenario TEXT NOT NULL,                -- 觸發場景描述
    message TEXT NOT NULL,                 -- 籤詩內容
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用戶遊戲數據表
CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,              -- LINE userId
    display_name TEXT DEFAULT '店員',       -- 顯示名稱
    total_xp INTEGER DEFAULT 0,            -- 總經驗值
    level INTEGER DEFAULT 1,               -- 等級（1-5）
    streak_days INTEGER DEFAULT 0,         -- 連續簽到天數
    last_checkin DATE,                     -- 最後簽到日期
    night_streak INTEGER DEFAULT 0,        -- 凌晨時段連續簽到天數（0:00-6:00）
    early_streak INTEGER DEFAULT 0,        -- 早班時段連續簽到天數（6:00-9:00）
    lucky_value INTEGER DEFAULT 0,         -- 幸運值（用於保底機制）
    total_draws INTEGER DEFAULT 0,         -- 總抽籤次數
    total_registrations INTEGER DEFAULT 0, -- 總登記次數
    total_removals INTEGER DEFAULT 0,      -- 總下架次數
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 抽籤歷史記錄表
CREATE TABLE IF NOT EXISTS fortune_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,                 -- LINE userId
    card_id INTEGER NOT NULL,              -- 抽中的籤卡 ID
    trigger_type TEXT DEFAULT 'manual',    -- 觸發類型（manual/task_complete/daily/streak）
    drawn_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES fortune_cards(id)
);

-- 成就徽章定義表
CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,             -- 徽章代碼
    name TEXT NOT NULL,                    -- 徽章名稱
    description TEXT,                      -- 徽章描述
    icon TEXT,                             -- 徽章圖示（emoji）
    rarity TEXT DEFAULT 'R',               -- 稀有度（N/R/SR/SSR）
    condition_type TEXT,                   -- 條件類型（register/remove/streak/level/draw）
    condition_value INTEGER,               -- 達成條件值
    xp_reward INTEGER DEFAULT 50           -- 獲得徽章的 XP 獎勵
);

-- 用戶已獲得徽章表
CREATE TABLE IF NOT EXISTS user_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    badge_id INTEGER NOT NULL,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (badge_id) REFERENCES badges(id),
    UNIQUE(user_id, badge_id)
);

-- XP 獲得記錄表
CREATE TABLE IF NOT EXISTS xp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    xp_amount INTEGER NOT NULL,
    action_type TEXT NOT NULL,             -- checkin/register/remove/streak/badge/draw
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 建立遊戲化相關索引
CREATE INDEX IF NOT EXISTS idx_fortune_history_user ON fortune_history(user_id);
CREATE INDEX IF NOT EXISTS idx_fortune_history_date ON fortune_history(drawn_at);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_logs_user ON xp_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_logs_date ON xp_logs(created_at);

-- 插入預設徽章
INSERT OR IGNORE INTO badges (code, name, description, icon, rarity, condition_type, condition_value, xp_reward) VALUES
('first_register', '🌱 新手上路', '第一次登記商品', '🌱', 'N', 'register', 1, 30),
('register_10', '📦 入門店員', '累積登記 10 件商品', '📦', 'R', 'register', 10, 50),
('register_50', '📦 資深店員', '累積登記 50 件商品', '📦', 'SR', 'register', 50, 100),
('register_100', '📸 拍照達人', '累積登記 100 件商品', '📸', 'SSR', 'register', 100, 200),
('remove_10', '🛡️ 效期新兵', '累積下架 10 件商品', '🛡️', 'R', 'remove', 10, 50),
('remove_50', '🛡️ 效期守護者', '累積下架 50 件商品', '🛡️', 'SR', 'remove', 50, 150),
('streak_7', '🔥 一週達人', '連續簽到 7 天', '🔥', 'R', 'streak', 7, 100),
('streak_14', '🔥 半月達人', '連續簽到 14 天', '🔥', 'SR', 'streak', 14, 200),
('streak_30', '🔥 月度冠軍', '連續簽到 30 天', '🔥', 'SSR', 'streak', 30, 500),
('draw_10', '🎴 初心抽卡師', '累積抽籤 10 次', '🎴', 'R', 'draw', 10, 50),
('draw_50', '🎴 命運占卜師', '累積抽籤 50 次', '🎴', 'SR', 'draw', 50, 100),
('level_3', '⭐ 效期達人', '達到 Lv.3', '⭐', 'SR', 'level', 3, 100),
('level_5', '👑 傳奇守護者', '達到 Lv.5', '👑', 'SSR', 'level', 5, 300),
('night_owl_7', '🌙 夜貓新手', '凌晨時段（0-6點）連續簽到 7 天', '🌙', 'SR', 'special', 7, 150),
('night_owl_30', '🌙 夜行者', '凌晨時段（0-6點）連續簽到 30 天', '🌙', 'SSR', 'special', 30, 500),
('early_bird', '🌅 早起鳥', '早班時段（6-9點）連續簽到 7 天', '🌅', 'SR', 'special', 7, 150);
