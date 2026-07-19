const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

const SETTING_KEY = 'student_quizzes';

function normalizeItem(raw = {}) {
    return {
        id: String(raw.id || `QUIZ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || raw.branchName || raw.campus || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        title: String(raw.title || '').trim(),
        totalMarks: String(raw.totalMarks || '').trim(),
        passMarks: String(raw.passMarks || '').trim(),
        dueDate: String(raw.dueDate || '').trim(),
        details: String(raw.details || '').trim(),
        questions: Array.isArray(raw.questions) ? raw.questions : [],
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
        let quizzes = await readItems(db);
        if (campus) quizzes = quizzes.filter((item) => String(item.campusName || '').trim().toLowerCase() === campus);
        if (classGrade) quizzes = quizzes.filter((item) => String(item.classGrade || '').trim().toLowerCase() === classGrade);
        sendJson(res, 200, { success: true, quizzes });
    },
    POST: async ({ res, db, body }) => {
        const item = normalizeItem(body || {});
        if (!item.campusName || !item.classGrade || !item.title || !item.totalMarks || !item.passMarks) {
            sendJson(res, 400, { success: false, message: 'Campus, class, title, total marks, and pass marks are required.' });
            return;
        }
        if (!item.questions.length && !item.file?.dataUrl && !item.file?.url) {
            sendJson(res, 400, { success: false, message: 'Add quiz questions or attach a quiz file.' });
            return;
        }
        const items = await readItems(db);
        const next = [item, ...items.filter((entry) => String(entry.id) !== String(item.id))];
        await writeItems(db, next);
        sendJson(res, 200, { success: true, quiz: item, quizzes: next });
    },
    DELETE: async ({ req, res, db }) => {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
        const next = (await readItems(db)).filter((entry) => String(entry.id) !== String(id));
        await writeItems(db, next);
        sendJson(res, 200, { success: true, quizzes: next });
    }
}, { getDb });
