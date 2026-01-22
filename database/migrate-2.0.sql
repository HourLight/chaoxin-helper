-- 潮欣小幫手 2.0 資料庫升級腳本
-- 執行此腳本以升級現有資料庫

-- 新增隱藏徽章相關欄位（如果不存在）
-- 注意：SQLite 的 ALTER TABLE 不支援 IF NOT EXISTS，需要手動處理

-- 檢查並新增 night_streak 欄位
-- 如果執行報錯 "duplicate column name"，表示欄位已存在，可忽略
ALTER TABLE user_stats ADD COLUMN night_streak INTEGER DEFAULT 0;

-- 檢查並新增 early_streak 欄位
ALTER TABLE user_stats ADD COLUMN early_streak INTEGER DEFAULT 0;

-- 新增隱藏徽章定義（如果不存在）
INSERT OR IGNORE INTO badges (code, name, description, icon, rarity, condition_type, condition_value, xp_reward) VALUES
('night_owl_7', '🌙 夜貓新手', '凌晨時段（0-6點）連續簽到 7 天', '🌙', 'SR', 'special', 7, 150),
('night_owl_30', '🌙 夜行者', '凌晨時段（0-6點）連續簽到 30 天', '🌙', 'SSR', 'special', 30, 500),
('early_bird', '🌅 早起鳥', '早班時段（6-9點）連續簽到 7 天', '🌅', 'SR', 'special', 7, 150);

-- 刪除舊的隱藏徽章定義（如果存在）
DELETE FROM badges WHERE code = 'night_owl' AND code NOT IN ('night_owl_7', 'night_owl_30');
