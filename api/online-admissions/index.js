const { collectionHandler } = require('../_lib/mobileCollectionHandler');

module.exports = collectionHandler({
    storeName: 'online_admissions',
    recordsKey: 'applications',
    itemKey: 'application',
    prefix: 'ADM',
    beforeSave: (payload = {}) => ({
        status: 'New',
        ...payload,
        status: payload.status || 'New'
    })
});
