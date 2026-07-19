const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

const SETTING_KEY = 'teacher_class_assignments';

function normalizeItem(raw = {}) {
    const now = new Date().toISOString();
    return {
        id: String(raw.id || `CLASS-ASG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        teacherId: String(raw.teacherId || '').trim(),
        teacherName: String(raw.teacherName || '').trim(),
        teacherCampusName: String(raw.teacherCampusName || '').trim(),
        classGrade: String(raw.classGrade || raw.className || raw.class || '').trim(),
        campusName: String(raw.campusName || '').trim(),
        note: String(raw.note || '').trim(),
        createdAt: raw.createdAt || now,
        updatedAt: raw.updatedAt || now
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
    GET: async ({ res, db }) => {
        sendJson(res, 200, { success: true, assignments: await readItems(db) });
    },
    POST: async ({ res, db, body }) => {
        const item = normalizeItem(body || {});
        if (!item.teacherId || !item.classGrade || !item.campusName) {
            sendJson(res, 400, { success: false, message: 'Teacher, class, and campus are required.' });
            return;
        }
        const items = await readItems(db);
        const next = [item, ...items.filter((entry) => String(entry.id) !== String(item.id))];
        await writeItems(db, next);
        sendJson(res, 200, { success: true, assignment: item, assignments: next });
    },
    DELETE: async ({ req, res, db }) => {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
        const next = (await readItems(db)).filter((entry) => String(entry.id) !== String(id));
        await writeItems(db, next);
        sendJson(res, 200, { success: true, assignments: next });
    }
}, { getDb });
