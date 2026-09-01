const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

const key = (value = '') => { const words = { one:'1', two:'2', three:'3', four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9', ten:'10' }; return String(value || '').trim().toLowerCase().replace(/^class\s+/, '').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, w => words[w]).replace(/[\s_-]+/g, ' '); };
const campusKey = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = createHandler({
    GET: async ({ req, res, db }) => {
        const requestedCampus = campusKey(new URL(req.url, 'http://localhost').searchParams.get('campus'));
        const students = await db.models.Student.findAll({ attributes: ['classGrade', 'campusName'] });
        const classes = new Map();
        students.forEach((student) => {
            if (requestedCampus && campusKey(student.campusName) !== requestedCampus) return;
            const value = String(student.classGrade || '').trim();
            if (value && !classes.has(key(value))) classes.set(key(value), value);
        });
        sendJson(res, 200, { success: true, classes: Array.from(classes.values()).sort((a, b) => a.localeCompare(b)) });
    }
}, { getDb });
