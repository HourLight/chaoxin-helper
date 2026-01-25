/**
 * 班表管理 API (PostgreSQL 版本)
 */

module.exports = function(db) {
    const express = require('express');
    const router = express.Router();
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });

    // ========== 班別設定 ==========

    // 取得所有班別
    router.get('/shift-types', async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM shift_types ORDER BY sort_order');
            res.json(result.rows);
        } catch (error) {
            console.error('取得班別失敗:', error);
            res.status(500).json({ error: '取得班別失敗' });
        }
    });

    // ========== 員工管理 ==========

    // 取得所有員工
    router.get('/employees', async (req, res) => {
        try {
            const result = await db.query(
                'SELECT * FROM employees WHERE is_active = true ORDER BY role DESC, name'
            );
            res.json(result.rows);
        } catch (error) {
            console.error('取得員工列表失敗:', error);
            res.status(500).json({ error: '取得員工列表失敗' });
        }
    });

    // 新增員工
    router.post('/employees', async (req, res) => {
        try {
            const { name, line_user_id, phone, role } = req.body;
            if (!name) {
                return res.status(400).json({ error: '請輸入員工姓名' });
            }

            const result = await db.query(
                'INSERT INTO employees (name, line_user_id, phone, role) VALUES ($1, $2, $3, $4) RETURNING *',
                [name, line_user_id || null, phone || null, role || 'staff']
            );

            res.json({ success: true, employee: result.rows[0] });
        } catch (error) {
            console.error('新增員工失敗:', error);
            res.status(500).json({ error: '新增員工失敗' });
        }
    });

    // 更新員工
    router.put('/employees/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { name, line_user_id, phone, role, is_active } = req.body;

            const result = await db.query(
                `UPDATE employees SET 
                    name = COALESCE($1, name),
                    line_user_id = $2,
                    phone = $3,
                    role = COALESCE($4, role),
                    is_active = COALESCE($5, is_active),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $6 RETURNING *`,
                [name, line_user_id, phone, role, is_active, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: '找不到員工' });
            }

            res.json({ success: true, employee: result.rows[0] });
        } catch (error) {
            console.error('更新員工失敗:', error);
            res.status(500).json({ error: '更新員工失敗' });
        }
    });

    // 刪除員工（軟刪除）
    router.delete('/employees/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await db.query('UPDATE employees SET is_active = false WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (error) {
            console.error('刪除員工失敗:', error);
            res.status(500).json({ error: '刪除員工失敗' });
        }
    });

    // 綁定員工 LINE ID
    router.post('/employees/:id/bind-line', async (req, res) => {
        try {
            const { id } = req.params;
            const { line_user_id } = req.body;

            const result = await db.query(
                'UPDATE employees SET line_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
                [line_user_id, id]
            );

            res.json({ success: true, employee: result.rows[0] });
        } catch (error) {
            console.error('綁定 LINE ID 失敗:', error);
            res.status(500).json({ error: '綁定失敗' });
        }
    });

    // ========== 班表管理 ==========

    // 取得指定日期範圍的班表
    router.get('/schedules', async (req, res) => {
        try {
            const { start_date, end_date, employee_id } = req.query;

            let query = `
                SELECT s.*, e.name as employee_name, e.role,
                       st.name as shift_name, st.start_time, st.end_time, st.color
                FROM schedules s
                JOIN employees e ON s.employee_id = e.id
                LEFT JOIN shift_types st ON s.shift_type = st.code
                WHERE e.is_active = true
            `;
            const params = [];
            let paramIndex = 1;

            if (start_date) {
                query += ` AND s.work_date >= $${paramIndex}`;
                params.push(start_date);
                paramIndex++;
            }

            if (end_date) {
                query += ` AND s.work_date <= $${paramIndex}`;
                params.push(end_date);
                paramIndex++;
            }

            if (employee_id) {
                query += ` AND s.employee_id = $${paramIndex}`;
                params.push(employee_id);
                paramIndex++;
            }

            query += ' ORDER BY s.work_date, e.name';

            const result = await db.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('取得班表失敗:', error);
            res.status(500).json({ error: '取得班表失敗' });
        }
    });

    // 取得某週班表（格式化輸出）
    router.get('/schedules/week', async (req, res) => {
        try {
            const { date } = req.query;
            const targetDate = date ? new Date(date) : new Date();
            
            // 計算本週一和週日
            const dayOfWeek = targetDate.getDay();
            const monday = new Date(targetDate);
            monday.setDate(targetDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            const startDate = monday.toISOString().split('T')[0];
            const endDate = sunday.toISOString().split('T')[0];

            // 取得所有員工
            const employeesResult = await db.query(
                'SELECT * FROM employees WHERE is_active = true ORDER BY role DESC, name'
            );

            // 取得本週班表
            const schedulesResult = await db.query(`
                SELECT s.*, e.name as employee_name, st.name as shift_name, st.color
                FROM schedules s
                JOIN employees e ON s.employee_id = e.id
                LEFT JOIN shift_types st ON s.shift_type = st.code
                WHERE s.work_date >= $1 AND s.work_date <= $2
                ORDER BY e.name, s.work_date
            `, [startDate, endDate]);

            // 組織資料
            const scheduleMap = {};
            schedulesResult.rows.forEach(s => {
                const key = `${s.employee_id}-${s.work_date.toISOString().split('T')[0]}`;
                scheduleMap[key] = s;
            });

            const weekDays = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                weekDays.push(d.toISOString().split('T')[0]);
            }

            const result = employeesResult.rows.map(emp => ({
                employee: emp,
                schedules: weekDays.map(date => {
                    const key = `${emp.id}-${date}`;
                    return scheduleMap[key] || { work_date: date, shift_type: null };
                })
            }));

            res.json({
                week_start: startDate,
                week_end: endDate,
                days: weekDays,
                data: result
            });
        } catch (error) {
            console.error('取得週班表失敗:', error);
            res.status(500).json({ error: '取得週班表失敗' });
        }
    });

    // 新增/更新單一班表
    router.post('/schedules', async (req, res) => {
        try {
            const { employee_id, work_date, shift_type, notes, created_by } = req.body;

            if (!employee_id || !work_date || !shift_type) {
                return res.status(400).json({ error: '請填寫完整資料' });
            }

            const result = await db.query(`
                INSERT INTO schedules (employee_id, work_date, shift_type, notes, created_by)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (employee_id, work_date) 
                DO UPDATE SET shift_type = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `, [employee_id, work_date, shift_type, notes || null, created_by || null]);

            res.json({ success: true, schedule: result.rows[0] });
        } catch (error) {
            console.error('儲存班表失敗:', error);
            res.status(500).json({ error: '儲存班表失敗' });
        }
    });

    // 批次上傳班表
    router.post('/schedules/batch', async (req, res) => {
        try {
            const { schedules, created_by } = req.body;

            if (!schedules || !Array.isArray(schedules)) {
                return res.status(400).json({ error: '無效的班表資料' });
            }

            let successCount = 0;
            let errorCount = 0;

            for (const s of schedules) {
                try {
                    await db.query(`
                        INSERT INTO schedules (employee_id, work_date, shift_type, notes, created_by)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (employee_id, work_date) 
                        DO UPDATE SET shift_type = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
                    `, [s.employee_id, s.work_date, s.shift_type, s.notes || null, created_by || null]);
                    successCount++;
                } catch (err) {
                    errorCount++;
                    console.error('單筆班表儲存失敗:', err);
                }
            }

            res.json({ 
                success: true, 
                message: `成功儲存 ${successCount} 筆，失敗 ${errorCount} 筆` 
            });
        } catch (error) {
            console.error('批次上傳班表失敗:', error);
            res.status(500).json({ error: '批次上傳失敗' });
        }
    });

    // 上傳 CSV 班表
    router.post('/schedules/upload-csv', upload.single('file'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: '請上傳檔案' });
            }

            const csvContent = req.file.buffer.toString('utf-8');
            const lines = csvContent.split('\n').filter(line => line.trim());
            
            if (lines.length < 2) {
                return res.status(400).json({ error: 'CSV 格式錯誤' });
            }

            // 解析標題列（日期）
            const headers = lines[0].split(',').map(h => h.trim());
            // headers[0] = 員工, headers[1...7] = 日期

            const results = [];
            const errors = [];

            // 解析每一列（每位員工）
            for (let i = 1; i < lines.length; i++) {
                const cells = lines[i].split(',').map(c => c.trim());
                const employeeName = cells[0];

                if (!employeeName) continue;

                // 查找員工
                const empResult = await db.query(
                    'SELECT id FROM employees WHERE name = $1 AND is_active = true',
                    [employeeName]
                );

                if (empResult.rows.length === 0) {
                    errors.push(`找不到員工: ${employeeName}`);
                    continue;
                }

                const employeeId = empResult.rows[0].id;

                // 處理每一天的班別
                for (let j = 1; j < cells.length && j < headers.length; j++) {
                    const dateStr = headers[j];
                    const shiftCode = cells[j].toLowerCase();

                    if (!dateStr || !shiftCode) continue;

                    // 轉換班別代碼
                    let shift = shiftCode;
                    if (shiftCode.includes('早') || shiftCode === 'm') shift = 'morning';
                    else if (shiftCode.includes('晚') || shiftCode === 'e') shift = 'evening';
                    else if (shiftCode.includes('夜') || shiftCode === 'n') shift = 'night';
                    else if (shiftCode.includes('休') || shiftCode === 'o' || shiftCode === 'off') shift = 'off';

                    try {
                        await db.query(`
                            INSERT INTO schedules (employee_id, work_date, shift_type, created_by)
                            VALUES ($1, $2, $3, 'csv_upload')
                            ON CONFLICT (employee_id, work_date) 
                            DO UPDATE SET shift_type = $3, updated_at = CURRENT_TIMESTAMP
                        `, [employeeId, dateStr, shift]);
                        results.push({ employee: employeeName, date: dateStr, shift });
                    } catch (err) {
                        errors.push(`${employeeName} ${dateStr}: ${err.message}`);
                    }
                }
            }

            res.json({
                success: true,
                message: `成功匯入 ${results.length} 筆班表`,
                imported: results.length,
                errors: errors
            });
        } catch (error) {
            console.error('CSV 上傳失敗:', error);
            res.status(500).json({ error: 'CSV 上傳失敗: ' + error.message });
        }
    });

    // 刪除班表
    router.delete('/schedules/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await db.query('DELETE FROM schedules WHERE id = $1', [id]);
            res.json({ success: true });
        } catch (error) {
            console.error('刪除班表失敗:', error);
            res.status(500).json({ error: '刪除班表失敗' });
        }
    });

    // ========== 員工個人查詢 ==========

    // 依 LINE ID 查詢自己的班表
    router.get('/my-schedule', async (req, res) => {
        try {
            const { line_user_id, days } = req.query;

            if (!line_user_id) {
                return res.status(400).json({ error: '請提供 LINE ID' });
            }

            // 查找員工
            const empResult = await db.query(
                'SELECT * FROM employees WHERE line_user_id = $1 AND is_active = true',
                [line_user_id]
            );

            if (empResult.rows.length === 0) {
                return res.status(404).json({ error: '尚未綁定員工帳號' });
            }

            const employee = empResult.rows[0];
            const daysToFetch = parseInt(days) || 7;

            // 取得未來 N 天的班表
            const schedulesResult = await db.query(`
                SELECT s.*, st.name as shift_name, st.start_time, st.end_time, st.color
                FROM schedules s
                LEFT JOIN shift_types st ON s.shift_type = st.code
                WHERE s.employee_id = $1 
                AND s.work_date >= CURRENT_DATE
                AND s.work_date < CURRENT_DATE + INTERVAL '1 day' * $2
                ORDER BY s.work_date
            `, [employee.id, daysToFetch]);

            res.json({
                employee: employee,
                schedules: schedulesResult.rows
            });
        } catch (error) {
            console.error('查詢個人班表失敗:', error);
            res.status(500).json({ error: '查詢失敗' });
        }
    });

    // 查詢今天/明天誰上班
    router.get('/who-works', async (req, res) => {
        try {
            const { date } = req.query;
            const targetDate = date || new Date().toISOString().split('T')[0];

            const result = await db.query(`
                SELECT s.*, e.name as employee_name, e.phone,
                       st.name as shift_name, st.start_time, st.end_time, st.color
                FROM schedules s
                JOIN employees e ON s.employee_id = e.id
                LEFT JOIN shift_types st ON s.shift_type = st.code
                WHERE s.work_date = $1 AND e.is_active = true AND s.shift_type != 'off'
                ORDER BY st.sort_order, e.name
            `, [targetDate]);

            // 按班別分組
            const grouped = {
                morning: [],
                evening: [],
                night: []
            };

            result.rows.forEach(r => {
                if (grouped[r.shift_type]) {
                    grouped[r.shift_type].push(r);
                }
            });

            res.json({
                date: targetDate,
                shifts: grouped,
                total: result.rows.length
            });
        } catch (error) {
            console.error('查詢上班人員失敗:', error);
            res.status(500).json({ error: '查詢失敗' });
        }
    });

    return router;
};
