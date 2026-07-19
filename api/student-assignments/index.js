const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

function formatSubmission(record) {
    const raw = record && typeof record.toJSON === 'function' ? record.toJSON() : (record || {});
    return {
        id: raw.id || '',
        studentId: raw.studentId || '',
        studentCode: raw.studentCode || '',
        studentName: raw.studentName || '',
        rollNo: raw.rollNo || '',
        campusName: raw.campusName || '',
        classGrade: raw.classGrade || '',
        sourceAssignmentId: raw.sourceAssignmentId || '',
        assignmentTitle: raw.assignmentTitle || '',
        subject: raw.subject || '',
        note: raw.note || '',
        fileName: raw.fileName || '',
        fileType: raw.fileType || '',
        fileData: raw.fileData || '',
        totalMarks: raw.totalMarks || '',
        passMarks: raw.passMarks || '',
        obtainedMarks: raw.obtainedMarks || '',
        resultStatus: raw.resultStatus || '',
        submittedAt: raw.submittedAt || raw.createdAt || '',
        status: raw.status || raw.resultStatus || 'Submitted'
    };
}

function normalizeSubmission(body = {}) {
    const submittedAt = new Date().toISOString();
    return {
        id: body.id || `ASG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        studentId: body.studentId || '',
        studentCode: body.studentCode || '',
        studentName: body.studentName || 'Student',
        rollNo: body.rollNo || '',
        campusName: body.campusName || '',
        classGrade: body.classGrade || '',
        sourceAssignmentId: body.sourceAssignmentId || '',
        assignmentTitle: body.assignmentTitle || '',
        subject: body.subject || '',
        note: body.note || '',
        fileName: body.fileName || body.file?.name || '',
        fileType: body.fileType || body.file?.type || '',
        fileData: body.fileData || body.file?.dataUrl || '',
        totalMarks: body.totalMarks || '',
        passMarks: body.passMarks || '',
        obtainedMarks: body.obtainedMarks || '',
        resultStatus: body.resultStatus || '',
        submittedAt: body.submittedAt || submittedAt,
        status: body.status || body.resultStatus || 'Submitted'
    };
}

module.exports = createHandler({
    GET: async ({ res, db }) => {
        const records = await db.models.StudentAssignmentSubmission.findAll({
            order: [['submittedAt', 'DESC']]
        });
        sendJson(res, 200, { success: true, assignments: records.map(formatSubmission) });
    },
    POST: async ({ res, db, body }) => {
        const record = normalizeSubmission(body || {});
        if (!record.assignmentTitle) {
            sendJson(res, 400, { success: false, message: 'Assignment title is required.' });
            return;
        }

        await db.models.StudentAssignmentSubmission.upsert(record);
        const records = await db.models.StudentAssignmentSubmission.findAll({
            order: [['submittedAt', 'DESC']]
        });
        sendJson(res, 200, {
            success: true,
            assignment: formatSubmission(record),
            assignments: records.map(formatSubmission)
        });
    }
}, { getDb });
