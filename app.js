const path = require('path');
const fs = require('fs');
const Module = require('module');
const express = require('express');

const cloudLinuxNodeModules = path.join(__dirname, '..', 'nodevenv', path.basename(__dirname), 'node_modules');
if (fs.existsSync(cloudLinuxNodeModules)) {
    process.env.NODE_PATH = process.env.NODE_PATH
        ? `${cloudLinuxNodeModules}${path.delimiter}${process.env.NODE_PATH}`
        : cloudLinuxNodeModules;
    Module._initPaths();
}

let ready = false;
let bootError = null;

const bootstrapApp = express();

bootstrapApp.get(['/health', '/api/health', '/api/ping'], (_req, res) => {
    res.status(ready ? 200 : 503).json({
        success: ready,
        online: ready,
        starting: !ready,
        error: bootError ? bootError.message : undefined,
        timestamp: new Date().toISOString()
    });
});

bootstrapApp.use((req, res, next) => {
    if (ready) return next();

    if (req.url === '/health' || req.url === '/api/health' || req.url === '/api/ping') {
        return next();
    }

    res.status(503).type('text/plain').send('School CRM is starting. Please refresh in a moment.');
});

const PORT = Number(process.env.PORT || 3000);
const BOOTSTRAP_DELAY_MS = Number(process.env.BOOTSTRAP_DELAY_MS || 3500);

function loadCrmBackend() {
    try {
        require('dotenv').config({ path: path.join(__dirname, '.env') });

        const logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const { app, attachSocketServer, startServer } = require('./backend/core');
        attachSocketServer(bootstrapServer);
        bootstrapApp.use(app);
        ready = true;

        startServer()
            .then(() => {
                console.log('School CRM startup completed');
            })
            .catch((error) => {
                bootError = error;
                console.error('Startup failed:', error?.message || error);
            });
    } catch (error) {
        bootError = error;
        console.error('Startup failed:', error?.message || error);
        process.exit(1);
    }
}

const bootstrapServer = bootstrapApp.listen(PORT, '0.0.0.0', () => {
    console.log(`School CRM listening on port ${PORT}`);
    setTimeout(loadCrmBackend, BOOTSTRAP_DELAY_MS);
});

bootstrapServer.on('error', (error) => {
    console.error('Server listen failed:', error?.message || error);
    process.exit(1);
});
