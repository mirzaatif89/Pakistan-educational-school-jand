const { createHandler, sendJson } = require('../_lib/http');
const { deleteRecord } = require('../_lib/mobileStore');
const { updateRecord } = require('../_lib/mobileCollectionHandler');

module.exports = createHandler({
    POST: async ({ req, res, body }) => {
        const updated = updateRecord('online_admissions', req.query.id, body || {});
        if (!updated) return sendJson(res, 404, { success: false, message: 'Application not found.' });
        sendJson(res, 200, { success: true, application: updated.record, applications: updated.records });
    },
    DELETE: async ({ req, res }) => {
        sendJson(res, 200, {
            success: true,
            deleted: true,
            applications: deleteRecord('online_admissions', req.query.id)
        });
    }
});
