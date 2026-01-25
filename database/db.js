/**
 * 潮欣小幫手 - PostgreSQL 資料庫連線模組
 */

const { Pool } = require('pg');

// 建立連線池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 測試連線
pool.on('connect', () => {
    console.log('✅ PostgreSQL 資料庫已連線');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL 連線錯誤:', err);
});

// 初始化資料庫結構
async function initDatabase() {
    const client = await pool.connect();
    try {
        console.log('🔧 正在初始化資料庫結構...');
        
        // 使用者表
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 商品表
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                barcode TEXT UNIQUE,
                name TEXT NOT NULL,
                category TEXT,
                storage_temp TEXT DEFAULT 'refrigerated' CHECK(storage_temp IN ('refrigerated', 'frozen', 'room_temp')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 庫存記錄表
        await client.query(`
            CREATE TABLE IF NOT EXISTS inventory (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                quantity INTEGER DEFAULT 1,
                expiry_date TIMESTAMP NOT NULL,
                status TEXT DEFAULT 'in_stock' CHECK(status IN ('in_stock', 'sold', 'disposed', 'removed')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 通知設定表
        await client.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // LINE Bot 設定表
        await client.query(`
            CREATE TABLE IF NOT EXISTS line_settings (
                id SERIAL PRIMARY KEY,
                channel_secret TEXT,
                channel_access_token TEXT,
                group_id TEXT,
                is_active INTEGER DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 通知記錄表
        await client.query(`
            CREATE TABLE IF NOT EXISTS notification_logs (
                id SERIAL PRIMARY KEY,
                inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
                message TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'failed', 'acknowledged'))
            )
        `);

        // 籤卡表
        await client.query(`
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
            )
        `);

        // 用戶遊戲數據表
        await client.query(`
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
            )
        `);

        // 抽籤歷史記錄表
        await client.query(`
            CREATE TABLE IF NOT EXISTS fortune_history (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                card_id INTEGER NOT NULL REFERENCES fortune_cards(id),
                trigger_type TEXT DEFAULT 'manual',
                drawn_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 操作記錄表
        await client.query(`
            CREATE TABLE IF NOT EXISTS operation_logs (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_name TEXT,
                action TEXT NOT NULL,
                inventory_id INTEGER REFERENCES inventory(id),
                product_name TEXT,
                details TEXT,
                source TEXT DEFAULT 'line',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 店員資料表
        await client.query(`
            CREATE TABLE IF NOT EXISTS staff (
                id SERIAL PRIMARY KEY,
                user_id TEXT UNIQUE NOT NULL,
                display_name TEXT,
                nickname TEXT,
                role TEXT DEFAULT 'staff',
                is_active INTEGER DEFAULT 1,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 成就徽章定義表
        await client.query(`
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
            )
        `);

        // 用戶已獲得徽章表
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_badges (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                badge_id INTEGER NOT NULL REFERENCES badges(id),
                earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, badge_id)
            )
        `);

        // XP 獲得記錄表
        await client.query(`
            CREATE TABLE IF NOT EXISTS xp_logs (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                xp_amount INTEGER NOT NULL,
                action_type TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 建立索引
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_fortune_history_user ON fortune_history(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_staff_user ON staff(user_id)`);

        // 插入預設設定（使用 ON CONFLICT DO NOTHING）
        await client.query(`
            INSERT INTO settings (key, value) VALUES ('notification_hours_before', '24')
            ON CONFLICT (key) DO NOTHING
        `);
        await client.query(`
            INSERT INTO settings (key, value) VALUES ('notification_enabled', 'true')
            ON CONFLICT (key) DO NOTHING
        `);
        await client.query(`
            INSERT INTO settings (key, value) VALUES ('notification_cron_time', '0 10 * * *')
            ON CONFLICT (key) DO NOTHING
        `);

        // 插入預設管理員
        await client.query(`
            INSERT INTO users (name, email, role) VALUES ('管理員', 'admin@chaoxin.local', 'admin')
            ON CONFLICT (email) DO NOTHING
        `);

        // 插入預設徽章
        const badges = [
            ['first_register', '🌱 新手上路', '第一次登記商品', '🌱', 'N', 'register', 1, 30],
            ['register_10', '📦 入門店員', '累積登記 10 件商品', '📦', 'R', 'register', 10, 50],
            ['register_50', '📦 資深店員', '累積登記 50 件商品', '📦', 'SR', 'register', 50, 100],
            ['register_100', '📸 拍照達人', '累積登記 100 件商品', '📸', 'SSR', 'register', 100, 200],
            ['remove_10', '🛡️ 效期新兵', '累積下架 10 件商品', '🛡️', 'R', 'remove', 10, 50],
            ['remove_50', '🛡️ 效期守護者', '累積下架 50 件商品', '🛡️', 'SR', 'remove', 50, 150],
            ['streak_7', '🔥 一週達人', '連續簽到 7 天', '🔥', 'R', 'streak', 7, 100],
            ['streak_14', '🔥 半月達人', '連續簽到 14 天', '🔥', 'SR', 'streak', 14, 200],
            ['streak_30', '🔥 月度冠軍', '連續簽到 30 天', '🔥', 'SSR', 'streak', 30, 500],
            ['draw_10', '🎴 初心抽卡師', '累積抽籤 10 次', '🎴', 'R', 'draw', 10, 50],
            ['draw_50', '🎴 命運占卜師', '累積抽籤 50 次', '🎴', 'SR', 'draw', 50, 100],
            ['level_3', '⭐ 效期達人', '達到 Lv.3', '⭐', 'SR', 'level', 3, 100],
            ['level_5', '👑 傳奇守護者', '達到 Lv.5', '👑', 'SSR', 'level', 5, 300],
            ['night_owl_7', '🌙 夜貓新手', '凌晨時段連續簽到 7 天', '🌙', 'SR', 'special', 7, 150],
            ['night_owl_30', '🌙 夜行者', '凌晨時段連續簽到 30 天', '🌙', 'SSR', 'special', 30, 500],
            ['early_bird', '🌅 早起鳥', '早班時段連續簽到 7 天', '🌅', 'SR', 'special', 7, 150]
        ];

        for (const badge of badges) {
            await client.query(`
                INSERT INTO badges (code, name, description, icon, rarity, condition_type, condition_value, xp_reward)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (code) DO NOTHING
            `, badge);
        }

        // ========== 班表系統資料表 ==========
        
        // 員工資料表
        await client.query(`
            CREATE TABLE IF NOT EXISTS employees (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                line_user_id VARCHAR(50),
                phone VARCHAR(20),
                role VARCHAR(20) DEFAULT 'staff',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 班別設定表
        await client.query(`
            CREATE TABLE IF NOT EXISTS shift_types (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(50) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                color VARCHAR(20) DEFAULT '#FF6B35',
                sort_order INTEGER DEFAULT 0
            )
        `);

        // 班表資料表
        await client.query(`
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
            )
        `);

        // 建立班表索引
        await client.query(`CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(work_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_schedules_employee ON schedules(employee_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_line_id ON employees(line_user_id)`);

        // 插入預設班別
        const shiftTypes = [
            ['morning', '☀️ 早班', '07:00', '15:00', '#FF9800', 1],
            ['evening', '🌅 晚班', '15:00', '23:00', '#2196F3', 2],
            ['night', '🌙 大夜班', '23:00', '07:00', '#673AB7', 3],
            ['off', '🏖️ 休假', '00:00', '00:00', '#4CAF50', 4]
        ];

        for (const shift of shiftTypes) {
            await client.query(`
                INSERT INTO shift_types (code, name, start_time, end_time, color, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (code) DO NOTHING
            `, shift);
        }

        console.log('✅ 資料庫結構初始化完成！');
        
    } catch (error) {
        console.error('❌ 資料庫初始化失敗:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 匯出
module.exports = {
    pool,
    query: (text, params) => pool.query(text, params),
    initDatabase
};
