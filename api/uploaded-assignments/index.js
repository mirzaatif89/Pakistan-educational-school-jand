const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

const SETTING_KEY = 'uploaded_assignments';

function normalizeItem(raw = {}) {
    return {
        id: String(raw.id || `UPLOADED-ASG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        startDate: String(raw.startDate || '').trim(),
        dueDate: String(raw.dueDate || '').trim(),
        totalMarks: String(raw.totalMarks || '').trim(),
        passMarks: String(raw.passMarks || '').trim(),
        file: raw.file && typeof raw.file === 'object' ? {
            name: String(raw.file.name || '').trim(),
            type: String(raw.file.type || '').trim(),
            dataUrl: String(raw.file.dataUrl || '').trim()
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
    GET: async ({ res, db }) => {
        sendJson(res, 200, { success: true, assignments: await readItems(db) });
    },
    POST: async ({ res, db, body }) => {
        const item = normalizeItem(body || {});
        if (!item.campusName || !item.classGrade || !item.startDate || !item.dueDate || !item.totalMarks || !item.passMarks || !item.file?.dataUrl) {
            sendJson(res, 400, { success: false, message: 'Campus, class, dates, marks, and file are required.' });
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
