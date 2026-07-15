const { createHandler, sendJson } = require('./http');
const { deleteRecord, readStore, upsertRecord, writeStore } = require('./mobileStore');

function collectionHandler({ storeName, recordsKey, itemKey, prefix, beforeSave }) {
    return createHandler({
        GET: async ({ res }) => {
            sendJson(res, 200, { success: true, [recordsKey]: readStore(storeName) });
        },
        POST: async ({ res, body }) => {
            const payload = beforeSave ? beforeSave(body || {}) : body || {};
            const { record, records } = upsertRecord(storeName, payload, prefix);
            sendJson(res, 200, { success: true, [itemKey]: record, [recordsKey]: records });
        },
        DELETE: async ({ req, res }) => {
            const id = String(req.query.id || '').trim();
            if (!id) return sendJson(res, 400, { success: false, message: 'id query parameter is required.' });
            sendJson(res, 200, { success: true, deleted: true, [recordsKey]: deleteRecord(storeName, id) });
        }
    });
}

function updateRecord(storeName, id, patch = {}) {
    const records = readStore(storeName);
    const index = records.findIndex((item) => String(item.id) === String(id));
    if (index < 0) return null;
    records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
    writeStore(storeName, records);
    return { record: records[index], records };
}

module.exports = {
    collectionHandler,
    updateRecord
};
