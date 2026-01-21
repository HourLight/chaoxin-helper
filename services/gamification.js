/**
 * 潮欣小幫手 2.0 - 遊戲化服務
 * 處理 XP 積分、等級升級、成就徽章
 */

module.exports = function(db) {

    // 等級設定
    const LEVEL_CONFIG = [
        { level: 1, name: '見習店員', minXP: 0, maxXP: 100 },
        { level: 2, name: '資深店員', minXP: 101, maxXP: 300 },
        { level: 3, name: '效期達人', minXP: 301, maxXP: 600 },
        { level: 4, name: '店長之星', minXP: 601, maxXP: 1000 },
        { level: 5, name: '傳奇守護者', minXP: 1001, maxXP: 999999 }
    ];

    // XP 獎勵設定
    const XP_REWARDS = {
        checkin: 5,           // 每日簽到
        register: 20,         // 登記商品
        remove: 30,           // 下架商品（攔截過期品）
        streak_7: 100,        // 連續 7 天
        streak_14: 200,       // 連續 14 天
        streak_30: 500,       // 連續 30 天
        badge: 50,            // 獲得徽章
        draw: 5               // 抽籤
    };

    /**
     * 取得或建立用戶統計
     */
    function getOrCreateUserStats(userId, displayName = '店員') {
        let stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
        
        if (!stats) {
            db.prepare(`
                INSERT INTO user_stats (user_id, display_name, total_xp, level, streak_days, lucky_value)
                VALUES (?, ?, 0, 1, 0, 0)
            `).run(userId, displayName);
            stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId);
        }
        
        return stats;
    }

    /**
     * 更新用戶顯示名稱
     */
    function updateDisplayName(userId, displayName) {
        db.prepare('UPDATE user_stats SET display_name = ? WHERE user_id = ?').run(displayName, userId);
    }

    /**
     * 增加 XP 並檢查升級
     */
    function addXP(userId, amount, actionType, description = '') {
        const stats = getOrCreateUserStats(userId);
        const newXP = stats.total_xp + amount;
        
        // 計算新等級
        let newLevel = 1;
        for (const config of LEVEL_CONFIG) {
            if (newXP >= config.minXP) {
                newLevel = config.level;
            }
        }

        const leveledUp = newLevel > stats.level;

        // 更新用戶統計
        db.prepare(`
            UPDATE user_stats 
            SET total_xp = ?, level = ?, updated_at = datetime('now')
            WHERE user_id = ?
        `).run(newXP, newLevel, userId);

        // 記錄 XP 獲得
        db.prepare(`
            INSERT INTO xp_logs (user_id, xp_amount, action_type, description)
            VALUES (?, ?, ?, ?)
        `).run(userId, amount, actionType, description);

        // 如果升級，檢查等級徽章
        if (leveledUp) {
            checkLevelBadge(userId, newLevel);
        }

        return {
            previousXP: stats.total_xp,
            newXP,
            previousLevel: stats.level,
            newLevel,
            leveledUp,
            levelName: LEVEL_CONFIG.find(c => c.level === newLevel)?.name || '未知'
        };
    }

    /**
     * 每日簽到
     */
    function dailyCheckin(userId, displayName = '店員') {
        const stats = getOrCreateUserStats(userId, displayName);
        const today = new Date().toISOString().split('T')[0];
        
        // 檢查是否已簽到
        if (stats.last_checkin === today) {
            return {
                success: false,
                message: '今天已經簽到過囉！',
                alreadyCheckedIn: true
            };
        }

        // 計算連續天數
        let newStreak = 1;
        if (stats.last_checkin) {
            const lastDate = new Date(stats.last_checkin);
            const todayDate = new Date(today);
            const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
                newStreak = stats.streak_days + 1;
            }
        }

        // 更新簽到資訊
        db.prepare(`
            UPDATE user_stats 
            SET last_checkin = ?, streak_days = ?, updated_at = datetime('now')
            WHERE user_id = ?
        `).run(today, newStreak, userId);

        // 基礎簽到 XP
        let xpResult = addXP(userId, XP_REWARDS.checkin, 'checkin', `每日簽到 Day ${newStreak}`);

        // 連續簽到獎勵
        let streakBonus = null;
        if (newStreak === 7) {
            addXP(userId, XP_REWARDS.streak_7, 'streak', '連續簽到 7 天獎勵');
            streakBonus = { days: 7, xp: XP_REWARDS.streak_7 };
            checkStreakBadge(userId, 7);
        } else if (newStreak === 14) {
            addXP(userId, XP_REWARDS.streak_14, 'streak', '連續簽到 14 天獎勵');
            streakBonus = { days: 14, xp: XP_REWARDS.streak_14 };
            checkStreakBadge(userId, 14);
        } else if (newStreak === 30) {
            addXP(userId, XP_REWARDS.streak_30, 'streak', '連續簽到 30 天獎勵');
            streakBonus = { days: 30, xp: XP_REWARDS.streak_30 };
            checkStreakBadge(userId, 30);
        }

        return {
            success: true,
            streak: newStreak,
            xpGained: XP_REWARDS.checkin,
            streakBonus,
            ...xpResult
        };
    }

    /**
     * 記錄商品登記（增加 XP 和統計）
     */
    function recordRegistration(userId) {
        const stats = getOrCreateUserStats(userId);
        
        // 更新登記次數
        db.prepare(`
            UPDATE user_stats 
            SET total_registrations = total_registrations + 1, updated_at = datetime('now')
            WHERE user_id = ?
        `).run(userId);

        // 增加 XP
        const xpResult = addXP(userId, XP_REWARDS.register, 'register', '登記商品');

        // 檢查登記徽章
        const newCount = stats.total_registrations + 1;
        checkRegistrationBadge(userId, newCount);

        return {
            totalRegistrations: newCount,
            ...xpResult
        };
    }

    /**
     * 記錄商品下架（增加 XP 和統計）
     */
    function recordRemoval(userId) {
        const stats = getOrCreateUserStats(userId);
        
        // 更新下架次數
        db.prepare(`
            UPDATE user_stats 
            SET total_removals = total_removals + 1, updated_at = datetime('now')
            WHERE user_id = ?
        `).run(userId);

        // 增加 XP
        const xpResult = addXP(userId, XP_REWARDS.remove, 'remove', '下架商品');

        // 檢查下架徽章
        const newCount = stats.total_removals + 1;
        checkRemovalBadge(userId, newCount);

        return {
            totalRemovals: newCount,
            ...xpResult
        };
    }

    /**
     * 檢查並授予登記徽章
     */
    function checkRegistrationBadge(userId, count) {
        const badges = [
            { code: 'first_register', threshold: 1 },
            { code: 'register_10', threshold: 10 },
            { code: 'register_50', threshold: 50 },
            { code: 'register_100', threshold: 100 }
        ];

        for (const badge of badges) {
            if (count >= badge.threshold) {
                awardBadge(userId, badge.code);
            }
        }
    }

    /**
     * 檢查並授予下架徽章
     */
    function checkRemovalBadge(userId, count) {
        const badges = [
            { code: 'remove_10', threshold: 10 },
            { code: 'remove_50', threshold: 50 }
        ];

        for (const badge of badges) {
            if (count >= badge.threshold) {
                awardBadge(userId, badge.code);
            }
        }
    }

    /**
     * 檢查並授予連續簽到徽章
     */
    function checkStreakBadge(userId, streak) {
        const badges = [
            { code: 'streak_7', threshold: 7 },
            { code: 'streak_14', threshold: 14 },
            { code: 'streak_30', threshold: 30 }
        ];

        for (const badge of badges) {
            if (streak >= badge.threshold) {
                awardBadge(userId, badge.code);
            }
        }
    }

    /**
     * 檢查並授予等級徽章
     */
    function checkLevelBadge(userId, level) {
        const badges = [
            { code: 'level_3', threshold: 3 },
            { code: 'level_5', threshold: 5 }
        ];

        for (const badge of badges) {
            if (level >= badge.threshold) {
                awardBadge(userId, badge.code);
            }
        }
    }

    /**
     * 授予徽章
     */
    function awardBadge(userId, badgeCode) {
        // 檢查是否已擁有
        const existing = db.prepare(`
            SELECT ub.* FROM user_badges ub
            JOIN badges b ON ub.badge_id = b.id
            WHERE ub.user_id = ? AND b.code = ?
        `).get(userId, badgeCode);

        if (existing) {
            return null; // 已擁有
        }

        // 取得徽章資訊
        const badge = db.prepare('SELECT * FROM badges WHERE code = ?').get(badgeCode);
        if (!badge) {
            return null;
        }

        // 授予徽章
        db.prepare(`
            INSERT INTO user_badges (user_id, badge_id)
            VALUES (?, ?)
        `).run(userId, badge.id);

        // 獲得徽章 XP 獎勵
        if (badge.xp_reward > 0) {
            addXP(userId, badge.xp_reward, 'badge', `獲得徽章：${badge.name}`);
        }

        return badge;
    }

    /**
     * 取得用戶所有徽章
     */
    function getUserBadges(userId) {
        return db.prepare(`
            SELECT b.*, ub.earned_at
            FROM user_badges ub
            JOIN badges b ON ub.badge_id = b.id
            WHERE ub.user_id = ?
            ORDER BY ub.earned_at DESC
        `).all(userId);
    }

    /**
     * 取得所有徽章（含用戶是否已獲得）
     */
    function getAllBadgesWithStatus(userId) {
        return db.prepare(`
            SELECT b.*, 
                   CASE WHEN ub.id IS NOT NULL THEN 1 ELSE 0 END as owned,
                   ub.earned_at
            FROM badges b
            LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = ?
            ORDER BY b.id
        `).all(userId);
    }

    /**
     * 取得用戶完整遊戲化資料
     */
    function getUserGameData(userId) {
        const stats = getOrCreateUserStats(userId);
        const badges = getUserBadges(userId);
        const levelConfig = LEVEL_CONFIG.find(c => c.level === stats.level);
        const nextLevelConfig = LEVEL_CONFIG.find(c => c.level === stats.level + 1);

        // 計算升級進度
        let progress = 100;
        let xpToNextLevel = 0;
        if (nextLevelConfig) {
            const currentLevelXP = stats.total_xp - levelConfig.minXP;
            const levelRange = nextLevelConfig.minXP - levelConfig.minXP;
            progress = Math.min(100, Math.floor((currentLevelXP / levelRange) * 100));
            xpToNextLevel = nextLevelConfig.minXP - stats.total_xp;
        }

        return {
            userId,
            displayName: stats.display_name,
            totalXP: stats.total_xp,
            level: stats.level,
            levelName: levelConfig?.name || '未知',
            streakDays: stats.streak_days,
            lastCheckin: stats.last_checkin,
            totalRegistrations: stats.total_registrations,
            totalRemovals: stats.total_removals,
            totalDraws: stats.total_draws,
            luckyValue: stats.lucky_value,
            progress,
            xpToNextLevel,
            nextLevelName: nextLevelConfig?.name || '已滿級',
            badges,
            badgeCount: badges.length
        };
    }

    /**
     * 取得排行榜（本週/本月）
     */
    function getLeaderboard(type = 'weekly', limit = 10) {
        let dateFilter = '';
        if (type === 'weekly') {
            dateFilter = "AND created_at >= date('now', '-7 days')";
        } else if (type === 'monthly') {
            dateFilter = "AND created_at >= date('now', '-30 days')";
        }

        return db.prepare(`
            SELECT 
                us.user_id,
                us.display_name,
                us.level,
                us.total_xp,
                COALESCE(SUM(xl.xp_amount), 0) as period_xp
            FROM user_stats us
            LEFT JOIN xp_logs xl ON us.user_id = xl.user_id ${dateFilter}
            GROUP BY us.user_id
            ORDER BY period_xp DESC
            LIMIT ?
        `).all(limit);
    }

    /**
     * 取得今日戰報數據
     */
    function getDailyReport() {
        const today = new Date().toISOString().split('T')[0];
        
        const registrations = db.prepare(`
            SELECT COUNT(*) as count FROM inventory 
            WHERE date(created_at) = date(?)
        `).get(today);

        const removals = db.prepare(`
            SELECT COUNT(*) as count FROM inventory 
            WHERE date(updated_at) = date(?) AND status IN ('disposed', 'removed')
        `).get(today);

        const activeUsers = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as count FROM xp_logs
            WHERE date(created_at) = date(?)
        `).get(today);

        const totalXPToday = db.prepare(`
            SELECT COALESCE(SUM(xp_amount), 0) as total FROM xp_logs
            WHERE date(created_at) = date(?)
        `).get(today);

        return {
            date: today,
            registrations: registrations.count,
            removals: removals.count,
            activeUsers: activeUsers.count,
            totalXP: totalXPToday.total
        };
    }

    /**
     * 建立每日戰報 Flex Message
     */
    function createDailyReportFlexMessage(report, stats) {
        return {
            type: 'flex',
            altText: '📊 今日戰報',
            contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#F7941D',
                    paddingAll: '15px',
                    contents: [
                        { type: 'text', text: '📊 今日戰報', weight: 'bold', size: 'xl', color: '#FFFFFF', align: 'center' },
                        { type: 'text', text: report.date, size: 'sm', color: '#FFFFFF', align: 'center', margin: 'sm' }
                    ]
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'md',
                    paddingAll: '20px',
                    contents: [
                        { type: 'box', layout: 'horizontal', contents: [
                            { type: 'text', text: '📦 今日登記', size: 'md', flex: 3 },
                            { type: 'text', text: `${report.registrations} 件`, size: 'md', weight: 'bold', color: '#1DB446', flex: 2, align: 'end' }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                            { type: 'text', text: '✅ 今日下架', size: 'md', flex: 3 },
                            { type: 'text', text: `${report.removals} 件`, size: 'md', weight: 'bold', color: '#FF6B35', flex: 2, align: 'end' }
                        ]},
                        { type: 'separator', margin: 'lg' },
                        { type: 'box', layout: 'horizontal', margin: 'lg', contents: [
                            { type: 'text', text: '⭐ 獲得經驗值', size: 'md', flex: 3 },
                            { type: 'text', text: `+${stats?.xpGained || report.totalXP} XP`, size: 'md', weight: 'bold', color: '#9B59B6', flex: 2, align: 'end' }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                            { type: 'text', text: '🔥 連續天數', size: 'md', flex: 3 },
                            { type: 'text', text: `${stats?.streak || 0} 天`, size: 'md', weight: 'bold', flex: 2, align: 'end' }
                        ]}
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    paddingAll: '15px',
                    contents: [
                        { type: 'text', text: '辛苦了！明天繼續加油 💪', size: 'sm', color: '#888888', align: 'center' }
                    ]
                }
            }
        };
    }

    /**
     * 建立用戶狀態 Flex Message
     */
    function createUserStatsFlexMessage(gameData) {
        const progressBar = '█'.repeat(Math.floor(gameData.progress / 10)) + '░'.repeat(10 - Math.floor(gameData.progress / 10));
        
        return {
            type: 'flex',
            altText: `💪 ${gameData.displayName} 的成就`,
            contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#1DB446',
                    paddingAll: '15px',
                    contents: [
                        { type: 'text', text: `💪 ${gameData.displayName}`, weight: 'bold', size: 'xl', color: '#FFFFFF', align: 'center' },
                        { type: 'text', text: `Lv.${gameData.level} ${gameData.levelName}`, size: 'md', color: '#FFFFFF', align: 'center', margin: 'sm' }
                    ]
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'md',
                    paddingAll: '20px',
                    contents: [
                        { type: 'box', layout: 'horizontal', contents: [
                            { type: 'text', text: '⭐ 總經驗值', size: 'sm', flex: 3 },
                            { type: 'text', text: `${gameData.totalXP} XP`, size: 'sm', weight: 'bold', flex: 2, align: 'end' }
                        ]},
                        { type: 'box', layout: 'vertical', margin: 'md', contents: [
                            { type: 'text', text: `升級進度 ${gameData.progress}%`, size: 'xs', color: '#888888' },
                            { type: 'text', text: progressBar, size: 'sm', margin: 'sm' },
                            { type: 'text', text: `還需 ${gameData.xpToNextLevel} XP → ${gameData.nextLevelName}`, size: 'xs', color: '#888888', margin: 'sm' }
                        ]},
                        { type: 'separator', margin: 'lg' },
                        { type: 'box', layout: 'horizontal', margin: 'lg', contents: [
                            { type: 'text', text: '🔥 連續簽到', size: 'sm', flex: 3 },
                            { type: 'text', text: `${gameData.streakDays} 天`, size: 'sm', weight: 'bold', flex: 2, align: 'end' }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                            { type: 'text', text: '📦 累積登記', size: 'sm', flex: 3 },
                            { type: 'text', text: `${gameData.totalRegistrations} 件`, size: 'sm', flex: 2, align: 'end' }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                            { type: 'text', text: '✅ 累積下架', size: 'sm', flex: 3 },
                            { type: 'text', text: `${gameData.totalRemovals} 件`, size: 'sm', flex: 2, align: 'end' }
                        ]},
                        { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                            { type: 'text', text: '🎴 抽籤次數', size: 'sm', flex: 3 },
                            { type: 'text', text: `${gameData.totalDraws} 次`, size: 'sm', flex: 2, align: 'end' }
                        ]},
                        { type: 'separator', margin: 'lg' },
                        { type: 'text', text: `🏅 已獲得 ${gameData.badgeCount} 個徽章`, size: 'sm', margin: 'lg', align: 'center' }
                    ]
                }
            }
        };
    }

    return {
        getOrCreateUserStats,
        updateDisplayName,
        addXP,
        dailyCheckin,
        recordRegistration,
        recordRemoval,
        awardBadge,
        getUserBadges,
        getAllBadgesWithStatus,
        getUserGameData,
        getLeaderboard,
        getDailyReport,
        createDailyReportFlexMessage,
        createUserStatsFlexMessage,
        LEVEL_CONFIG,
        XP_REWARDS
    };
};
