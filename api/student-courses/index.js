const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

const SETTING_KEY = 'student_courses';

function normalizeItem(raw = {}) {
    return {
        id: String(raw.id || `COURSE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || raw.branchName || raw.campus || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        title: String(raw.title || '').trim(),
        details: String(raw.details || '').trim(),
        file: raw.file && typeof raw.file === 'object' ? {
            name: String(raw.file.name || '').trim(),
            type: String(raw.file.type || '').trim(),
            dataUrl: String(raw.file.dataUrl || '').trim(),
            url: String(raw.file.url || '').trim(),
            size: Number(raw.file.size || 0) || 0
        } : null,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString()
    };
}

async function readItems(db) {
    const setting = await db.models.AppSetting.findByPk(SETTING_KEY);
    if (!setting) return [];
    try {
        const parsed = JSON.parse(setting.settingValue || '[]');
        return Array.isArray(parsed) ? parsed.map(normalizeItem) : [];
    } catch (_error) {
        return [];
    }
}

async function writeItems(db, items = []) {
    await db.models.AppSetting.upsert({
        settingKey: SETTING_KEY,
        settingValue: JSON.stringify(items.map(normalizeItem))
    });
}

module.exports = createHandler({
    GET: async ({ req, res, db }) => {
        const url = new URL(req.url, 'http://localhost');
        const campus = String(url.searchParams.get('campus') || '').trim().toLowerCase();
        const classGrade = String(url.searchParams.get('classGrade') || url.searchParams.get('class') || '').trim().toLowerCase();
        let courses = await readItems(db);
        if (campus) courses = courses.filter((item) => String(item.campusName || '').trim().toLowerCase() === campus);
        if (classGrade) courses = courses.filter((item) => String(item.classGrade || '').trim().toLowerCase() === classGrade);
        sendJson(res, 200, { success: true, courses });
    },
    POST: async ({ res, db, body }) => {
        const item = normalizeItem(body || {});
        if (!item.campusName || !item.classGrade || !item.title || !item.details) {
            sendJson(res, 400, { success: false, message: 'Campus, class, title, and details are required.' });
            return;
        }
        const items = await readItems(db);
        const next = [item, ...items.filter((entry) => String(entry.id) !== String(item.id))];
        await writeItems(db, next);
        sendJson(res, 200, { success: true, course: item, courses: next });
    },
    DELETE: async ({ req, res, db }) => {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
        const next = (await readItems(db)).filter((entry) => String(entry.id) !== String(id));
        await writeItems(db, next);
        sendJson(res, 200, { success: true, courses: next });
    }
}, { getDb });
