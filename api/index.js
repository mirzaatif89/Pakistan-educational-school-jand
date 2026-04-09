const { app, startServer } = require('../server');

module.exports = async (req, res) => {
    await startServer();
    return app(req, res);
};
