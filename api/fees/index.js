const { createHandler, sendJson } = require('../_lib/http');
const { getDb } = require('../_lib/db');

module.exports = createHandler({
    GET: async ({ res, db }) => {
        const { FeePayment } = db.models;
        const payments = await FeePayment.findAll({
            where: { status: 'Paid' },
            order: [['paidAt', 'DESC']]
        });

        sendJson(res, 200, {
            success: true,
            payments
        });
    }
}, { getDb });
