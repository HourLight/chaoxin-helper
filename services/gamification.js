/**
 * 潮欣小幫手 2.0 - 遊戲化服務 (PostgreSQL 版本)
 */

module.exports = function(db) {
    const LEVEL_CONFIG = [
        { level: 1, name: '見習店員', minXP: 0, maxXP: 100 },
        { level: 2, name: '資深店員', minXP: 101, maxXP: 300 },
        { level: 3, name: '效期達人', minXP: 301, maxXP: 600 },
        { level: 4, name: '店長之星', minXP: 601, maxXP: 1000 },
        { level: 5, name: '傳奇守護者', minXP: 1001, maxXP: 999999 }
    ];

    const XP_REWARDS = {
        checkin: 5, register: 20, remove: 30,
        streak_7: 100, streak_14: 200, streak_30: 500,
        badge: 50, draw: 5
    };

    async function getOrCreateUserStats(userId, displayName = '店員') {
        let result = await db.query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) {
            await db.query('INSERT INTO user_stats (user_id, display_name, total_xp, level, streak_days, lucky_value) VALUES ($1, $2, 0, 1, 0, 0)', [userId, displayName]);
            result = await db.query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
        }
        return result.rows[0];
    }

    async function updateDisplayName(userId, displayName) {
        await db.query('UPDATE user_stats SET display_name = $1 WHERE user_id = $2', [displayName, userId]);
    }

    async function addXP(userId, amount, actionType, description = '') {
        const stats = await getOrCreateUserStats(userId);
        const newXP = stats.total_xp + amount;
        let newLevel = 1;
        for (const config of LEVEL_CONFIG) { if (newXP >= config.minXP) newLevel = config.level; }
        const leveledUp = newLevel > stats.level;

        await db.query('UPDATE user_stats SET total_xp = $1, level = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3', [newXP, newLevel, userId]);
        await db.query('INSERT INTO xp_logs (user_id, xp_amount, action_type, description) VALUES ($1, $2, $3, $4)', [userId, amount, actionType, description]);
        if (leveledUp) await checkLevelBadge(userId, newLevel);

        return { previousXP: stats.total_xp, newXP, previousLevel: stats.level, newLevel, leveledUp, levelName: LEVEL_CONFIG.find(c => c.level === newLevel)?.name || '未知' };
    }

    async function dailyCheckin(userId, displayName = '店員') {
        const stats = await getOrCreateUserStats(userId, displayName);
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentHour = now.getHours();
        
        if (stats.last_checkin === today) return { success: false, message: '今天已經簽到過囉！', alreadyCheckedIn: true };

        let newStreak = 1;
        if (stats.last_checkin) {
            const diffDays = Math.floor((new Date(today) - new Date(stats.last_checkin)) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) newStreak = stats.streak_days + 1;
        }

        const isNightShift = currentHour >= 0 && currentHour < 6;
        const isEarlyShift = currentHour >= 6 && currentHour < 9;
        let newNightStreak = 0, newEarlyStreak = 0;
        
        if (stats.last_checkin) {
            const diffDays = Math.floor((new Date(today) - new Date(stats.last_checkin)) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                if (isNightShift) newNightStreak = (stats.night_streak || 0) + 1;
                if (isEarlyShift) newEarlyStreak = (stats.early_streak || 0) + 1;
            } else {
                if (isNightShift) newNightStreak = 1;
                if (isEarlyShift) newEarlyStreak = 1;
            }
        } else {
            if (isNightShift) newNightStreak = 1;
            if (isEarlyShift) newEarlyStreak = 1;
        }

        await db.query('UPDATE user_stats SET last_checkin = $1, streak_days = $2, night_streak = $3, early_streak = $4, updated_at = CURRENT_TIMESTAMP WHERE user_id = $5',
            [today, newStreak, newNightStreak, newEarlyStreak, userId]);

        let xpResult = await addXP(userId, XP_REWARDS.checkin, 'checkin', `每日簽到 Day ${newStreak}`);
        let streakBonus = null;
        if (newStreak === 7) { await addXP(userId, XP_REWARDS.streak_7, 'streak', '連續簽到 7 天'); streakBonus = { days: 7, xp: XP_REWARDS.streak_7 }; await checkStreakBadge(userId, 7); }
        else if (newStreak === 14) { await addXP(userId, XP_REWARDS.streak_14, 'streak', '連續簽到 14 天'); streakBonus = { days: 14, xp: XP_REWARDS.streak_14 }; await checkStreakBadge(userId, 14); }
        else if (newStreak === 30) { await addXP(userId, XP_REWARDS.streak_30, 'streak', '連續簽到 30 天'); streakBonus = { days: 30, xp: XP_REWARDS.streak_30 }; await checkStreakBadge(userId, 30); }

        let hiddenBadgeEarned = null;
        if (newNightStreak === 7) { const b = await awardBadge(userId, 'night_owl_7'); if (b) hiddenBadgeEarned = b; }
        if (newNightStreak === 30) { const b = await awardBadge(userId, 'night_owl_30'); if (b) hiddenBadgeEarned = b; }
        if (newEarlyStreak === 7) { const b = await awardBadge(userId, 'early_bird'); if (b) hiddenBadgeEarned = b; }

        return { success: true, streak: newStreak, xpGained: XP_REWARDS.checkin, streakBonus, nightStreak: newNightStreak, earlyStreak: newEarlyStreak, isNightShift, isEarlyShift, hiddenBadgeEarned, ...xpResult };
    }

    async function recordRegistration(userId) {
        const stats = await getOrCreateUserStats(userId);
        await db.query('UPDATE user_stats SET total_registrations = total_registrations + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1', [userId]);
        const xpResult = await addXP(userId, XP_REWARDS.register, 'register', '登記商品');
        const newCount = stats.total_registrations + 1;
        await checkRegistrationBadge(userId, newCount);
        return { totalRegistrations: newCount, ...xpResult };
    }

    async function recordRemoval(userId) {
        const stats = await getOrCreateUserStats(userId);
        await db.query('UPDATE user_stats SET total_removals = total_removals + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1', [userId]);
        const xpResult = await addXP(userId, XP_REWARDS.remove, 'remove', '下架商品');
        const newCount = stats.total_removals + 1;
        await checkRemovalBadge(userId, newCount);
        return { totalRemovals: newCount, ...xpResult };
    }

    async function checkRegistrationBadge(userId, count) {
        const badges = [{ code: 'first_register', threshold: 1 }, { code: 'register_10', threshold: 10 }, { code: 'register_50', threshold: 50 }, { code: 'register_100', threshold: 100 }];
        for (const badge of badges) { if (count >= badge.threshold) await awardBadge(userId, badge.code); }
    }

    async function checkRemovalBadge(userId, count) {
        const badges = [{ code: 'remove_10', threshold: 10 }, { code: 'remove_50', threshold: 50 }];
        for (const badge of badges) { if (count >= badge.threshold) await awardBadge(userId, badge.code); }
    }

    async function checkStreakBadge(userId, streak) {
        const badges = [{ code: 'streak_7', threshold: 7 }, { code: 'streak_14', threshold: 14 }, { code: 'streak_30', threshold: 30 }];
        for (const badge of badges) { if (streak >= badge.threshold) await awardBadge(userId, badge.code); }
    }

    async function checkLevelBadge(userId, level) {
        const badges = [{ code: 'level_3', threshold: 3 }, { code: 'level_5', threshold: 5 }];
        for (const badge of badges) { if (level >= badge.threshold) await awardBadge(userId, badge.code); }
    }

    async function awardBadge(userId, badgeCode) {
        const existing = await db.query('SELECT ub.* FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = $1 AND b.code = $2', [userId, badgeCode]);
        if (existing.rows.length > 0) return null;

        const badgeResult = await db.query('SELECT * FROM badges WHERE code = $1', [badgeCode]);
        if (badgeResult.rows.length === 0) return null;
        const badge = badgeResult.rows[0];

        await db.query('INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2)', [userId, badge.id]);
        if (badge.xp_reward > 0) await addXP(userId, badge.xp_reward, 'badge', `獲得徽章：${badge.name}`);
        return badge;
    }

    async function getUserBadges(userId) {
        const result = await db.query('SELECT b.*, ub.earned_at FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = $1 ORDER BY ub.earned_at DESC', [userId]);
        return result.rows;
    }

    async function getAllBadgesWithStatus(userId) {
        const result = await db.query('SELECT b.*, CASE WHEN ub.id IS NOT NULL THEN 1 ELSE 0 END as owned, ub.earned_at FROM badges b LEFT JOIN user_badges ub ON b.id = ub.badge_id AND ub.user_id = $1 ORDER BY b.id', [userId]);
        return result.rows;
    }

    async function getUserGameData(userId) {
        const stats = await getOrCreateUserStats(userId);
        const badges = await getUserBadges(userId);
        const levelConfig = LEVEL_CONFIG.find(c => c.level === stats.level);
        const nextLevelConfig = LEVEL_CONFIG.find(c => c.level === stats.level + 1);

        let progress = 100, xpToNextLevel = 0;
        if (nextLevelConfig) {
            const currentLevelXP = stats.total_xp - levelConfig.minXP;
            const levelRange = nextLevelConfig.minXP - levelConfig.minXP;
            progress = Math.min(100, Math.floor((currentLevelXP / levelRange) * 100));
            xpToNextLevel = nextLevelConfig.minXP - stats.total_xp;
        }

        return {
            userId, displayName: stats.display_name, totalXP: stats.total_xp, level: stats.level,
            levelName: levelConfig?.name || '未知', streakDays: stats.streak_days, lastCheckin: stats.last_checkin,
            totalRegistrations: stats.total_registrations, totalRemovals: stats.total_removals, totalDraws: stats.total_draws,
            luckyValue: stats.lucky_value, progress, xpToNextLevel, nextLevelName: nextLevelConfig?.name || '已滿級',
            badges, badgeCount: badges.length
        };
    }

    async function getLeaderboard(type = 'weekly', limit = 10) {
        let dateFilter = '';
        if (type === 'weekly') dateFilter = "AND xl.created_at >= NOW() - INTERVAL '7 days'";
        else if (type === 'monthly') dateFilter = "AND xl.created_at >= NOW() - INTERVAL '30 days'";

        const result = await db.query(`
            SELECT us.user_id, us.display_name, us.level, us.total_xp, COALESCE(SUM(xl.xp_amount), 0) as period_xp
            FROM user_stats us LEFT JOIN xp_logs xl ON us.user_id = xl.user_id ${dateFilter}
            GROUP BY us.user_id, us.display_name, us.level, us.total_xp ORDER BY period_xp DESC LIMIT $1
        `, [limit]);
        return result.rows;
    }

    async function getDailyReport() {
        const regResult = await db.query("SELECT COUNT(*) as count FROM inventory WHERE DATE(created_at AT TIME ZONE 'Asia/Taipei') = CURRENT_DATE");
        const remResult = await db.query("SELECT COUNT(*) as count FROM inventory WHERE DATE(updated_at AT TIME ZONE 'Asia/Taipei') = CURRENT_DATE AND status IN ('disposed', 'removed')");
        const activeResult = await db.query("SELECT COUNT(DISTINCT user_id) as count FROM xp_logs WHERE DATE(created_at AT TIME ZONE 'Asia/Taipei') = CURRENT_DATE");
        const xpResult = await db.query("SELECT COALESCE(SUM(xp_amount), 0) as total FROM xp_logs WHERE DATE(created_at AT TIME ZONE 'Asia/Taipei') = CURRENT_DATE");

        return {
            date: new Date().toISOString().split('T')[0],
            registrations: parseInt(regResult.rows[0].count),
            removals: parseInt(remResult.rows[0].count),
            activeUsers: parseInt(activeResult.rows[0].count),
            totalXP: parseInt(xpResult.rows[0].total)
        };
    }

    function createDailyReportFlexMessage(report, stats) {
        return {
            type: 'flex', altText: '📊 今日戰報',
            contents: { type: 'bubble', size: 'mega',
                header: { type: 'box', layout: 'vertical', backgroundColor: '#F7941D', paddingAll: '15px',
                    contents: [{ type: 'text', text: '📊 今日戰報', weight: 'bold', size: 'xl', color: '#FFFFFF', align: 'center' },
                        { type: 'text', text: report.date, size: 'sm', color: '#FFFFFF', align: 'center', margin: 'sm' }] },
                body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
                    contents: [
                        { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '📦 今日登記', size: 'md', flex: 3 }, { type: 'text', text: `${report.registrations} 件`, size: 'md', weight: 'bold', color: '#1DB446', flex: 2, align: 'end' }] },
                        { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: '✅ 今日下架', size: 'md', flex: 3 }, { type: 'text', text: `${report.removals} 件`, size: 'md', weight: 'bold', color: '#FF6B35', flex: 2, align: 'end' }] },
                        { type: 'separator', margin: 'lg' },
                        { type: 'box', layout: 'horizontal', margin: 'lg', contents: [{ type: 'text', text: '⭐ 獲得經驗值', size: 'md', flex: 3 }, { type: 'text', text: `+${stats?.xpGained || report.totalXP} XP`, size: 'md', weight: 'bold', color: '#9B59B6', flex: 2, align: 'end' }] },
                        { type: 'box', layout: 'horizontal', margin: 'md', contents: [{ type: 'text', text: '🔥 連續天數', size: 'md', flex: 3 }, { type: 'text', text: `${stats?.streak || 0} 天`, size: 'md', weight: 'bold', flex: 2, align: 'end' }] }
                    ] },
                footer: { type: 'box', layout: 'vertical', paddingAll: '15px', contents: [{ type: 'text', text: '辛苦了！明天繼續加油 💪', size: 'sm', color: '#888888', align: 'center' }] }
            }
        };
    }

    function createUserStatsFlexMessage(gameData) {
        const progressBar = '█'.repeat(Math.floor(gameData.progress / 10)) + '░'.repeat(10 - Math.floor(gameData.progress / 10));
        return {
            type: 'flex', altText: `💪 ${gameData.displayName} 的成就`,
            contents: { type: 'bubble', size: 'mega',
                header: { type: 'box', layout: 'vertical', backgroundColor: '#1DB446', paddingAll: '15px',
                    contents: [{ type: 'text', text: `💪 ${gameData.displayName}`, weight: 'bold', size: 'xl', color: '#FFFFFF', align: 'center' },
                        { type: 'text', text: `Lv.${gameData.level} ${gameData.levelName}`, size: 'md', color: '#FFFFFF', align: 'center', margin: 'sm' }] },
                body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
                    contents: [
                        { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: '⭐ 總經驗值', size: 'sm', flex: 3 }, { type: 'text', text: `${gameData.totalXP} XP`, size: 'sm', weight: 'bold', flex: 2, align: 'end' }] },
                        { type: 'box', layout: 'vertical', margin: 'md', contents: [{ type: 'text', text: `升級進度 ${gameData.progress}%`, size: 'xs', color: '#888888' }, { type: 'text', text: progressBar, size: 'sm', margin: 'sm' }, { type: 'text', text: `還需 ${gameData.xpToNextLevel} XP → ${gameData.nextLevelName}`, size: 'xs', color: '#888888', margin: 'sm' }] },
                        { type: 'separator', margin: 'lg' },
                        { type: 'box', layout: 'horizontal', margin: 'lg', contents: [{ type: 'text', text: '🔥 連續簽到', size: 'sm', flex: 3 }, { type: 'text', text: `${gameData.streakDays} 天`, size: 'sm', weight: 'bold', flex: 2, align: 'end' }] },
                        { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '📦 累積登記', size: 'sm', flex: 3 }, { type: 'text', text: `${gameData.totalRegistrations} 件`, size: 'sm', flex: 2, align: 'end' }] },
                        { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '✅ 累積下架', size: 'sm', flex: 3 }, { type: 'text', text: `${gameData.totalRemovals} 件`, size: 'sm', flex: 2, align: 'end' }] },
                        { type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'text', text: '🎴 抽籤次數', size: 'sm', flex: 3 }, { type: 'text', text: `${gameData.totalDraws} 次`, size: 'sm', flex: 2, align: 'end' }] },
                        { type: 'separator', margin: 'lg' },
                        { type: 'text', text: `🏅 已獲得 ${gameData.badgeCount} 個徽章`, size: 'sm', margin: 'lg', align: 'center' }
                    ] }
            }
        };
    }

    return { getOrCreateUserStats, updateDisplayName, addXP, dailyCheckin, recordRegistration, recordRemoval, awardBadge, getUserBadges, getAllBadgesWithStatus, getUserGameData, getLeaderboard, getDailyReport, createDailyReportFlexMessage, createUserStatsFlexMessage, LEVEL_CONFIG, XP_REWARDS };
};
