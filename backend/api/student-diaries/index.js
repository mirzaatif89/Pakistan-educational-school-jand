const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

const SETTING_KEY = 'student_diaries';

function normalizeItem(raw = {}) {
    return {
        id: String(raw.id || `DIARY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        date: String(raw.date || '').trim(),
        title: String(raw.title || '').trim(),
        details: String(raw.details || '').trim(),
        file: raw.file || null,
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
    GET: async ({ res, db }) => {
        sendJson(res, 200, { success: true, diaries: await readItems(db) });
    },
    POST: async ({ res, db, body }) => {
        const incoming = Array.isArray(body?.items) ? body.items : [body].filter(Boolean);
        const records = incoming.map(normalizeItem).filter((item) => item.campusName && item.classGrade && item.date && item.title && item.details);
        if (!records.length) {
            sendJson(res, 400, { success: false, message: 'Campus, class, date, subject, and diary details are required.' });
            return;
        }
        const existing = await readItems(db);
        const ids = new Set(records.map((item) => String(item.id)));
        const next = [...records, ...existing.filter((entry) => !ids.has(String(entry.id)))];
        await writeItems(db, next);
        sendJson(res, 200, { success: true, diaries: next, saved: records });
    },
    DELETE: async ({ req, res, db }) => {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
        const next = (await readItems(db)).filter((entry) => String(entry.id) !== String(id));
        await writeItems(db, next);
        sendJson(res, 200, { success: true, diaries: next });
    }
}, { getDb });
