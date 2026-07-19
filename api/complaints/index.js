const { createHandler, sendJson } = require('../_lib/http');
const { readStore, upsertRecord } = require('../_lib/mobileStore');

function normalizeComplaintStatus(status = 'Pending') {
    const value = String(status || 'Pending').trim().toLowerCase();
    if (value === 'in progress' || value === 'in-progress') return 'In Progress';
    if (value === 'reply' || value === 'replied') return 'Replied';
    if (value === 'resolve' || value === 'resolved' || value === 'action taken') return 'Resolved';
    if (value === 'closed') return 'Closed';
    return 'Pending';
}

function normalizeComplaintRole(role = 'Student') {
    const value = String(role || 'Student').trim().toLowerCase();
    if (value === 'teacher') return 'Teacher';
    if (value === 'family' || value === 'parent' || value === 'parents') return 'Family';
    return 'Student';
}

function normalizeComplaint(payload = {}) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    return {
        ...raw,
        senderRole: normalizeComplaintRole(raw.senderRole),
        senderId: String(raw.senderId || '').trim(),
        senderName: String(raw.senderName || '').trim(),
        senderClass: String(raw.senderClass || '').trim(),
        campusName: String(raw.campusName || '').trim(),
        subject: String(raw.subject || '').trim(),
        message: String(raw.message || '').trim(),
        status: normalizeComplaintStatus(raw.status || 'Pending'),
        thread: Array.isArray(raw.thread) ? raw.thread : []
    };
}

module.exports = createHandler({
    GET: async ({ req, res }) => {
        const role = String(req.query.role || '').trim();
        const senderRole = role ? normalizeComplaintRole(role) : '';
        const complaints = readStore('complaints')
            .filter((item) => !senderRole || normalizeComplaintRole(item.senderRole) === senderRole)
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        sendJson(res, 200, { success: true, complaints });
    },
    POST: async ({ res, body }) => {
        const payload = normalizeComplaint(body || {});

        if (!payload.subject || !payload.message) {
            return sendJson(res, 400, { success: false, message: 'Subject and message are required.' });
        }
        if (payload.senderRole === 'Family' && !payload.senderName) {
            return sendJson(res, 400, { success: false, message: 'Family complainant name is required.' });
        }

        const { record, records } = upsertRecord('complaints', payload, 'CMP');
        sendJson(res, 200, { success: true, complaint: record, complaints: records });
    }
});
