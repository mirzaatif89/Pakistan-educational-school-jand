const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');
const { authenticateToken } = require('../_lib/services');

const classKey = (value = '') => { const words = { one:'1', two:'2', three:'3', four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9', ten:'10' }; return String(value || '').trim().toLowerCase().replace(/^class\s+/, '').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, w => words[w]).replace(/[\s_-]+/g, ' '); };
const campusKey = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const matches = (item, student) => {
    if (!classKey(item.classGrade) || classKey(item.classGrade) !== classKey(student.classGrade)) return false;
    const itemCampus = campusKey(item.campusName || item.branchName || item.campus);
    const studentCampus = campusKey(student.campusName);
    return !itemCampus || !studentCampus || itemCampus === studentCampus;
};

async function readSetting(db, settingKey) {
    const row = await db.models.AppSetting.findByPk(settingKey);
    try { const value = JSON.parse(row?.settingValue || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; }
}

module.exports = createHandler({
    GET: async ({ req, res, db }) => {
        const user = authenticateToken(req);
        if (user.role !== 'Student') return sendJson(res, 403, { success: false, message: 'Student access only.' });
        const student = await db.models.Student.findByPk(user.id, { attributes: ['id', 'studentCode', 'fullName', 'campusName', 'classGrade'] });
        if (!student) return sendJson(res, 404, { success: false, message: 'Student record not found.' });
        const profile = student.get({ plain: true });
        const [diaries, courses, quizzes] = await Promise.all([
            readSetting(db, 'student_diaries'), readSetting(db, 'student_courses'), readSetting(db, 'student_quizzes')
        ]);
        sendJson(res, 200, {
            success: true, student: profile,
            diaries: diaries.filter((item) => matches(item, profile)),
            courses: courses.filter((item) => matches(item, profile)),
            quizzes: quizzes.filter((item) => matches(item, profile))
        });
    }
}, { getDb });
