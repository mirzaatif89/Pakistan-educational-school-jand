const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

function normalizePlacement(value) {
    return String(value || '').trim().toLowerCase() === 'banner' ? 'banner' : 'ad';
}

function formatBanner(record) {
    const raw = record && typeof record.toJSON === 'function' ? record.toJSON() : record;
    return {
        ...raw,
        placement: normalizePlacement(raw?.placement),
        displayOrder: Number(raw?.displayOrder || 0),
        isActive: raw?.isActive !== false
    };
}

module.exports = createHandler({
    DELETE: async ({ req, res, db }) => {
        const id = String(req.query?.id || req.params?.id || '').trim();
        if (!id) {
            sendJson(res, 400, { success: false, message: 'Banner id is required.' });
            return;
        }

        const deletedCount = await db.models.Banner.destroy({ where: { id } });
        const records = await db.models.Banner.findAll({
            order: [['displayOrder', 'ASC'], ['updatedAt', 'DESC']]
        });
        sendJson(res, 200, {
            success: true,
            deleted: deletedCount > 0,
            banners: records.map(formatBanner)
        });
    }
}, { getDb });
