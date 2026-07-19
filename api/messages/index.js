const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');
const { authenticateToken } = require('../_lib/services');

function normalizeMessageRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (role === 'student') return 'Student';
    if (role === 'teacher') return 'Teacher';
    if (role === 'staff') return 'Staff';
    return '';
}

function normalizeMessageScope(value) {
    const scope = String(value || '').trim().toLowerCase();
    return ['all', 'campus', 'class', 'individual'].includes(scope) ? scope : '';
}

function normalizeComparable(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatMessageRecord(record) {
    const raw = record && typeof record.toJSON === 'function' ? record.toJSON() : record;
    let thread = [];
    try {
        thread = Array.isArray(raw?.thread) ? raw.thread : JSON.parse(raw?.thread || '[]');
    } catch (_error) {
        thread = [];
    }
    return {
        ...raw,
        targetRole: normalizeMessageRole(raw?.targetRole),
        targetScope: normalizeMessageScope(raw?.targetScope) || 'all',
        thread: Array.isArray(thread) ? thread : [],
        chatStatus: raw?.chatStatus || 'open'
    };
}

async function getUserMessageProfile(db, user = {}) {
    const role = normalizeMessageRole(user.role);
    const id = String(user.id || '').trim();
    if (!role || !id) return { role, id };

    if (role === 'Student') {
        const student = await db.models.Student.findByPk(id);
        return {
            role,
            id,
            username: user.username || student?.username || '',
            fullName: student?.fullName || user.fullName || '',
            campusName: student?.campusName || user.campusName || '',
            classGrade: student?.classGrade || ''
        };
    }

    if (role === 'Teacher') {
        const teacher = await db.models.Teacher.findByPk(id);
        return {
            role,
            id,
            username: user.username || teacher?.username || '',
            fullName: teacher?.fullName || user.fullName || '',
            campusName: teacher?.campusName || user.campusName || ''
        };
    }

    const staff = await db.models.Staff.findByPk(id);
    return {
        role,
        id,
        username: user.username || staff?.username || '',
        fullName: staff?.fullName || user.fullName || '',
        campusName: user.campusName || ''
    };
}

function messageMatchesProfile(message = {}, profile = {}) {
    if (normalizeMessageRole(message.targetRole) !== profile.role) return false;
    const scope = normalizeMessageScope(message.targetScope) || 'all';
    if (scope === 'all') return true;
    if (scope === 'campus') {
        return normalizeComparable(message.campusName) && normalizeComparable(message.campusName) === normalizeComparable(profile.campusName);
    }
    if (scope === 'class') {
        return profile.role === 'Student'
            && normalizeComparable(message.campusName) === normalizeComparable(profile.campusName)
            && normalizeComparable(message.classGrade) === normalizeComparable(profile.classGrade);
    }
    if (scope === 'individual') {
        const target = normalizeComparable(message.recipientId);
        return target && [profile.id, profile.username].map(normalizeComparable).includes(target);
    }
    return false;
}

module.exports = createHandler({
    GET: async ({ req, res, db }) => {
        const user = authenticateToken(req);
        const records = await db.models.Message.findAll({ order: [['createdAt', 'DESC']] });
        let messages = records.map(formatMessageRecord);

        if (!['Admin', 'Principal'].includes(String(user.role || ''))) {
            const profile = await getUserMessageProfile(db, user);
            messages = messages.filter((message) => messageMatchesProfile(message, profile));
        } else if (req.query?.role) {
            const targetRole = normalizeMessageRole(req.query.role);
            messages = targetRole ? messages.filter((message) => message.targetRole === targetRole) : messages;
        }

        sendJson(res, 200, { success: true, messages });
    },
    POST: async ({ req, res, db, body }) => {
        const user = authenticateToken(req);
        const action = String(body?.action || '').trim().toLowerCase();
        if (action === 'reply' || action === 'end') {
            const id = String(body?.id || body?.messageId || '').trim();
            const record = id ? await db.models.Message.findByPk(id) : null;
            if (!record) {
                const error = new Error('Message not found.');
                error.statusCode = 404;
                throw error;
            }

            const message = formatMessageRecord(record);
            if (action === 'end') {
                if (!['Admin', 'Principal'].includes(String(user.role || ''))) {
                    const error = new Error('Admin access required.');
                    error.statusCode = 403;
                    throw error;
                }
                await record.update({ chatStatus: 'ended' });
            } else {
                if (message.chatStatus === 'ended') {
                    const error = new Error('This chat has ended.');
                    error.statusCode = 400;
                    throw error;
                }
                if (!['Admin', 'Principal'].includes(String(user.role || ''))) {
                    const profile = await getUserMessageProfile(db, user);
                    if (!messageMatchesProfile(message, profile)) {
                        const error = new Error('You cannot reply to this message.');
                        error.statusCode = 403;
                        throw error;
                    }
                }
                const replyText = String(body?.reply || body?.body || '').trim();
                if (!replyText) {
                    const error = new Error('Reply is required.');
                    error.statusCode = 400;
                    throw error;
                }
                const nextThread = [
                    ...message.thread,
                    {
                        role: ['Admin', 'Principal'].includes(String(user.role || '')) ? 'Admin' : String(user.role || 'User'),
                        name: user.fullName || user.username || user.role || 'User',
                        message: replyText,
                        createdAt: new Date().toISOString()
                    }
                ];
                await record.update({ thread: JSON.stringify(nextThread), chatStatus: 'open' });
            }

            const records = await db.models.Message.findAll({ order: [['createdAt', 'DESC']] });
            sendJson(res, 200, {
                success: true,
                message: formatMessageRecord(await db.models.Message.findByPk(id)),
                messages: records.map(formatMessageRecord)
            });
            return;
        }

        if (!['Admin', 'Principal'].includes(String(user.role || ''))) {
            const error = new Error('Admin access required.');
            error.statusCode = 403;
            throw error;
        }

        const targetRole = normalizeMessageRole(body?.targetRole);
        const targetScope = normalizeMessageScope(body?.targetScope);
        const subject = String(body?.subject || '').trim();
        const messageBody = String(body?.body || '').trim();
        const campusName = String(body?.campusName || '').trim();
        const classGrade = String(body?.classGrade || '').trim();
        const recipientId = String(body?.recipientId || '').trim();

        if (!targetRole || !targetScope || !subject || !messageBody) {
            const error = new Error('Role, scope, subject, and message are required.');
            error.statusCode = 400;
            throw error;
        }
        if (targetScope === 'campus' && !campusName) {
            const error = new Error('Select campus for campus message.');
            error.statusCode = 400;
            throw error;
        }
        if (targetScope === 'class' && (!campusName || !classGrade || targetRole !== 'Student')) {
            const error = new Error('Class messages require Student role, campus, and class.');
            error.statusCode = 400;
            throw error;
        }
        if (targetScope === 'individual' && !recipientId) {
            const error = new Error('Select a recipient for individual message.');
            error.statusCode = 400;
            throw error;
        }

        const message = {
            id: body?.id || `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            subject,
            body: messageBody,
            targetRole,
            targetScope,
            campusName: campusName || null,
            classGrade: classGrade || null,
            recipientId: recipientId || null,
            recipientName: String(body?.recipientName || '').trim() || null,
            senderName: user.fullName || user.username || 'Admin',
            thread: JSON.stringify([]),
            chatStatus: 'open',
            createdAtLabel: new Date().toLocaleString('en-GB')
        };

        await db.models.Message.create(message);
        const records = await db.models.Message.findAll({ order: [['createdAt', 'DESC']] });
        sendJson(res, 200, {
            success: true,
            message: formatMessageRecord(message),
            messages: records.map(formatMessageRecord)
        });
    }
}, { getDb });
