const { createHandler, sendJson } = require('../_lib/http');
const { deleteRecord, readStore, writeStore } = require('../_lib/mobileStore');

function normalizeComplaintStatus(status = 'Pending') {
    const value = String(status || 'Pending').trim().toLowerCase();
    if (value === 'in progress' || value === 'in-progress') return 'In Progress';
    if (value === 'reply' || value === 'replied') return 'Replied';
    if (value === 'resolve' || value === 'resolved' || value === 'action taken') return 'Resolved';
    if (value === 'closed') return 'Closed';
    return 'Pending';
}

module.exports = createHandler({
    POST: async ({ req, res, body }) => {
        const records = readStore('complaints');
        const index = records.findIndex((item) => String(item.id) === String(req.query.id));
        if (index < 0) return sendJson(res, 404, { success: false, message: 'Complaint not found.' });

        const payload = body || {};
        const reply = String(payload.reply || '').trim();
        const patch = {
            ...payload,
            ...(payload.status ? { status: normalizeComplaintStatus(payload.status) } : {})
        };

        if (reply) {
            const now = new Date().toISOString();
            const thread = Array.isArray(records[index].thread) ? [...records[index].thread] : [];
            thread.push({
                role: String(payload.replyRole || 'Admin').trim() || 'Admin',
                name: String(payload.replyName || 'Admin').trim() || 'Admin',
                message: reply,
                createdAt: now
            });
            patch.thread = thread;
            patch.repliedAt = now;
        }

        records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
        const complaints = writeStore('complaints', records);
        sendJson(res, 200, { success: true, complaint: records[index], complaints });
    },
    DELETE: async ({ req, res }) => {
        sendJson(res, 200, {
            success: true,
            deleted: true,
            complaints: deleteRecord('complaints', req.query.id)
        });
    }
});
