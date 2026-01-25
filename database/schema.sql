-- 潮欣小幫手 資料庫結構
-- PostgreSQL 版本
-- 注意：實際初始化由 db.js 執行，此檔案僅供參考

-- 使用者表
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 商品表
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    storage_temp TEXT DEFAULT 'refrigerated' CHECK(storage_temp IN ('refrigerated', 'frozen', 'room_temp')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 庫存記錄表
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    expiry_date TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'in_stock' CHECK(status IN ('in_stock', 'sold', 'disposed', 'removed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 通知設定表
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LINE Bot 設定表
CREATE TABLE IF NOT EXISTS line_settings (
    id SERIAL PRIMARY KEY,
    channel_secret TEXT,
    channel_access_token TEXT,
    group_id TEXT,
    is_active INTEGER DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 籤卡表
CREATE TABLE IF NOT EXISTS fortune_cards (
    id SERIAL PRIMARY KEY,
    card_code TEXT UNIQUE NOT NULL,
    series TEXT NOT NULL,
    rarity TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    scenario TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用戶遊戲數據表
CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    display_name TEXT DEFAULT '店員',
    total_xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    streak_days INTEGER DEFAULT 0,
    last_checkin DATE,
    night_streak INTEGER DEFAULT 0,
    early_streak INTEGER DEFAULT 0,
    lucky_value INTEGER DEFAULT 0,
    total_draws INTEGER DEFAULT 0,
    total_registrations INTEGER DEFAULT 0,
    total_removals INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 抽籤歷史記錄表
CREATE TABLE IF NOT EXISTS fortune_history (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    card_id INTEGER NOT NULL REFERENCES fortune_cards(id),
    trigger_type TEXT DEFAULT 'manual',
    drawn_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 成就徽章定義表
CREATE TABLE IF NOT EXISTS badges (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    rarity TEXT DEFAULT 'R',
    condition_type TEXT,
    condition_value INTEGER,
    xp_reward INTEGER DEFAULT 50
);

-- 用戶已獲得徽章表
CREATE TABLE IF NOT EXISTS user_badges (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    badge_id INTEGER NOT NULL REFERENCES badges(id),
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, badge_id)
);

-- XP 獲得記錄表
CREATE TABLE IF NOT EXISTS xp_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    xp_amount INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========== 班表系統 ==========

-- 員工資料表
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    line_user_id VARCHAR(50),
    phone VARCHAR(20),
    role VARCHAR(20) DEFAULT 'staff',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 班別設定表
CREATE TABLE IF NOT EXISTS shift_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    color VARCHAR(20) DEFAULT '#FF6B35',
    sort_order INTEGER DEFAULT 0
);

-- 班表資料表
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    shift_type VARCHAR(20) NOT NULL,
    notes TEXT,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, work_date)
);

-- ========== 索引 ==========

CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(work_date);
CREATE INDEX IF NOT EXISTS idx_schedules_employee ON schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_line_id ON employees(line_user_id);
