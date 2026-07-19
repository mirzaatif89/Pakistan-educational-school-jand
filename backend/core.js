const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { Sequelize, DataTypes, Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const { getSmtpConfig, sendSmtpEmail } = require('../api/_lib/mailer');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
let io = null;

function attachSocketServer(targetServer = server) {
    if (!io) {
        io = new Server(targetServer, { cors: { origin: '*' } });
    }
    return io;
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || 'eduCore_secret_key_2026';
const PERMISSIONS_FILE = path.join(DATA_DIR, 'permissions.json');
const DETAILED_PERMISSIONS_FILE = path.join(DATA_DIR, 'permissions-detailed.json');
const DATE_SHEET_FILE = path.join(DATA_DIR, 'date_sheet.json');
const UPLOADED_ASSIGNMENTS_FILE = path.join(DATA_DIR, 'uploaded_assignments.json');
const UPLOADED_LECTURES_FILE = path.join(DATA_DIR, 'uploaded_lectures.json');
const STUDENT_DIARIES_FILE = path.join(DATA_DIR, 'student_diaries.json');
const STUDENT_ASSIGNMENT_SUBMISSIONS_FILE = path.join(DATA_DIR, 'student_assignment_submissions.json');
const MOBILE_STORE_DIR = path.join(DATA_DIR, 'mobile_api_store');
const ONLINE_ADMISSIONS_FILE = path.join(MOBILE_STORE_DIR, 'online_admissions.json');
const COMPLAINTS_FILE = path.join(MOBILE_STORE_DIR, 'complaints.json');
const ADMIN_CREDENTIALS_FILE = path.join(DATA_DIR, 'admin_credentials.json');
const PRINCIPAL_USERNAME = process.env.PRINCIPAL_USERNAME || 'principal@school.com';
const PRINCIPAL_PASSWORD = process.env.PRINCIPAL_PASSWORD || 'Principal123';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const corsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false,
    maxAge: 86400
};

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', req.path.startsWith('/api') ? 'no-store' : 'public, max-age=60');
    next();
});
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
const RESERVED_ROUTE_NAMES = new Set(['api', 'health', 'socket.io']);

function resolvePageFileByRoute(routeName = '') {
    const normalized = String(routeName || '').trim().toLowerCase();
    if (!normalized) return '';
    if (RESERVED_ROUTE_NAMES.has(normalized)) return '';
    if (normalized === 'login') return 'login.html';
    if (normalized === 'index' || normalized === 'website') return 'index.html';
    if (!/^[a-z0-9_-]+$/i.test(normalized)) return '';

    const candidate = `${normalized}.html`;
    const candidatePath = path.join(FRONTEND_DIR, candidate);
    return fs.existsSync(candidatePath) ? candidate : '';
}

app.get('/', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.get('/:pageName([a-zA-Z0-9_-]+).html', (req, res, next) => {
    const pageName = String(req.params.pageName || '').toLowerCase();
    if (RESERVED_ROUTE_NAMES.has(pageName)) return next();

    const targetRoute = pageName === 'index' || pageName === 'website' ? '' : pageName;
    const targetFile = resolvePageFileByRoute(targetRoute);
    if (!targetFile && targetRoute) return next();

    return res.redirect(302, targetRoute ? `/${targetRoute}` : '/');
});

app.get('/:routeName([a-zA-Z0-9_-]+)', (req, res, next) => {
    const pageFile = resolvePageFileByRoute(req.params.routeName);
    if (!pageFile) return next();
    return res.sendFile(path.join(FRONTEND_DIR, pageFile));
});

app.use(express.static(FRONTEND_DIR));

app.get('/health', (_req, res) => {
    res.json({
        success: true,
        initialized: isInitialized,
        timestamp: new Date().toISOString()
    });
});

app.get(['/api/health', '/api/ping'], (_req, res) => {
    res.json({
        success: true,
        online: true,
        initialized: isInitialized,
        timestamp: new Date().toISOString()
    });
});

let sequelize;
let startupPromise = null;
let isInitialized = false;
const ACTIVE_SESSION_TTL_MS = 90000;
const activeSessions = new Map();

const MODULE_KEYS = [
    'dashboard',
    'students',
    'teachers',
    'staff',
    'classes',
    'fees',
    'fee_challan',
    'teacher_salaries',
    'student_attendance',
    'teacher_attendance',
    'student_attendance_report',
    'teacher_attendance_report',
    'notifications',
    'messages',
    'special_notices',
    'online_admissions',
    'exams',
    'revenue',
    'settings',
    'permissions',
    'branch_registration',
    'aboutme',
    'student_portal'
];
const ACCESS_LEVELS = ['none', 'view', 'edit', 'manage'];
const ALLOWED_HOME_PAGES = new Set([
    'dashboard.html',
    'students.html',
    'teachers.html',
    'staff.html',
    'classes.html',
    'fees.html',
    'set_fees.html',
    'fee_challan.html',
    'teacher_salaries.html',
    'student_attendance.html',
    'teacher_attendance.html',
    'student_attendance_report.html',
    'teacher_attendance_report.html',
    'notifications.html',
    'messages.html',
    'special_notices.html',
    'online_admissions.html',
    'exams.html',
    'revenue.html',
    'settings.html',
    'permissions.html',
    'branch_registration.html',
    'aboutme.html',
    'student_portal.html'
]);

function buildModuleSet(defaultAccess = 'none', overrides = {}) {
    const acc = MODULE_KEYS.reduce((next, key) => {
        const requested = overrides[key];
        next[key] = ACCESS_LEVELS.includes(requested) ? requested : defaultAccess;
        return next;
    }, {});
    Object.entries(overrides || {}).forEach(([key, value]) => {
        if (!acc[key] && ACCESS_LEVELS.includes(value)) acc[key] = value;
    });
    return acc;
}

const defaultPermissions = {
    loginAccess: {
        admin: true,
        principal: true,
        branch: true,
        teacher: true,
        student: true,
        staff: true
    },
    roleGroups: {
        Admin: 'superadmin',
        Principal: 'admin',
        Branch: 'computer_operator',
        Teacher: 'computer_operator',
        Student: 'computer_operator',
        Staff: 'computer_operator'
    },
    groups: {
        superadmin: {
            name: 'Superadmin',
            homePage: 'dashboard.html',
            permissions: buildModuleSet('manage')
        },
        admin: {
            name: 'Admin',
            homePage: 'dashboard.html',
            permissions: buildModuleSet('none', {
                dashboard: 'manage',
                students: 'manage',
                teachers: 'manage',
                staff: 'manage',
                classes: 'manage',
                fees: 'manage',
                fee_challan: 'manage',
                teacher_salaries: 'manage',
                student_attendance: 'manage',
                teacher_attendance: 'manage',
                student_attendance_report: 'view',
                teacher_attendance_report: 'view',
                notifications: 'manage',
                messages: 'manage',
                special_notices: 'manage',
                online_admissions: 'manage',
                exams: 'manage',
                revenue: 'view',
                settings: 'view',
                branch_registration: 'view',
                permissions: 'view',
                aboutme: 'view'
            })
        },
        computer_operator: {
            name: 'Computer Operator',
            homePage: 'dashboard.html',
            permissions: buildModuleSet('none', {
                dashboard: 'view',
                students: 'manage',
                teachers: 'view',
                staff: 'view',
                classes: 'view',
                fees: 'view',
                fee_challan: 'manage',
                student_attendance: 'edit',
                exams: 'view',
                notifications: 'view',
                messages: 'view',
                online_admissions: 'none',
                aboutme: 'view'
            })
        }
    }
};

function normalizePermissionsConfig(input = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const groupsInput = raw.groups && typeof raw.groups === 'object' ? raw.groups : {};
    const customModules = Array.isArray(raw.customModules) ? raw.customModules : [];
    const allowedHomePages = new Set(ALLOWED_HOME_PAGES);
    customModules.forEach((module) => {
        if (module && module.page) allowedHomePages.add(String(module.page));
    });
    const groups = Object.entries({
        ...defaultPermissions.groups,
        ...groupsInput
    }).reduce((acc, [key, groupValue]) => {
        const baseGroup = defaultPermissions.groups[key] || {
            name: key,
            homePage: 'dashboard.html',
            permissions: buildModuleSet('none'),
            actionPermissions: undefined
        };
        const nextGroup = groupValue && typeof groupValue === 'object' ? groupValue : {};
        const requestedHomePage = String(nextGroup.homePage || baseGroup.homePage || 'dashboard.html');
        const actionPermissions = nextGroup.actionPermissions && typeof nextGroup.actionPermissions === 'object'
            ? nextGroup.actionPermissions
            : (baseGroup.actionPermissions && typeof baseGroup.actionPermissions === 'object' ? baseGroup.actionPermissions : undefined);
        acc[key] = {
            name: String(nextGroup.name || baseGroup.name || key),
            homePage: allowedHomePages.has(requestedHomePage) ? requestedHomePage : 'dashboard.html',
            permissions: buildModuleSet('none', {
                ...baseGroup.permissions,
                ...(nextGroup.permissions || {})
            }),
            ...(actionPermissions ? { actionPermissions } : {})
        };
        return acc;
    }, {});

    return {
        loginAccess: {
            ...defaultPermissions.loginAccess,
            ...(raw.loginAccess || {})
        },
        roleGroups: {
            ...defaultPermissions.roleGroups,
            ...(raw.roleGroups || {})
        },
        customModules,
        groups
    };
}

function isPasswordHash(value) {
    return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

function normalizeOptionalEmail(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || null;
}

async function ensureUniqueTeacherIdentity(Teacher, User, item) {
    const teacherId = item.id || null;
    const normalizedEmail = normalizeOptionalEmail(item.email);
    const normalizedUsername = String(item.username || '').trim();

    if (!normalizedUsername) {
        throw new Error('Teacher username is required.');
    }

    const usernameConflict = await Teacher.findOne({
        where: {
            username: normalizedUsername,
            ...(teacherId ? { id: { [Op.ne]: teacherId } } : {})
        }
    });

    if (usernameConflict) {
        throw new Error('This teacher username is already assigned to another teacher.');
    }

    const userUsernameConflict = await User.findOne({
        where: {
            username: normalizedUsername,
            ...(teacherId ? { profileId: { [Op.ne]: teacherId } } : {})
        }
    });

    if (userUsernameConflict) {
        throw new Error('This username is already used by another account.');
    }

    if (normalizedEmail) {
        const emailConflict = await Teacher.findOne({
            where: {
                email: normalizedEmail,
                ...(teacherId ? { id: { [Op.ne]: teacherId } } : {})
            }
        });

        if (emailConflict) {
            throw new Error('This teacher email is already assigned to another teacher.');
        }

        const userEmailConflict = await User.findOne({
            where: {
                email: normalizedEmail,
                ...(teacherId ? { profileId: { [Op.ne]: teacherId } } : {})
            }
        });

        if (userEmailConflict) {
            throw new Error('This email is already used by another account.');
        }
    }
}

async function ensureUniqueStudentIdentity(Student, User, item) {
    const studentId = item.id || null;
    const normalizedEmail = normalizeOptionalEmail(item.email);
    const normalizedUsername = String(item.username || '').trim();

    if (normalizedUsername) {
        const usernameConflict = await Student.findOne({
            where: {
                username: normalizedUsername,
                ...(studentId ? { id: { [Op.ne]: studentId } } : {})
            }
        });

        if (usernameConflict) {
            throw new Error('This student username is already assigned to another student.');
        }

        const userUsernameConflict = await User.findOne({
            where: {
                username: normalizedUsername,
                ...(studentId ? { profileId: { [Op.ne]: studentId } } : {})
            }
        });

        if (userUsernameConflict) {
            throw new Error('This username is already used by another account.');
        }
    }

    if (normalizedEmail) {
        const emailConflict = await Student.findOne({
            where: {
                email: normalizedEmail,
                ...(studentId ? { id: { [Op.ne]: studentId } } : {})
            }
        });

        if (emailConflict) {
            throw new Error('This student email is already assigned to another student.');
        }

        const userEmailConflict = await User.findOne({
            where: {
                email: normalizedEmail,
                ...(studentId ? { profileId: { [Op.ne]: studentId } } : {})
            }
        });

        if (userEmailConflict) {
            throw new Error('This email is already used by another account.');
        }
    }
}

function isLocalDbHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function shouldAutoCreateDatabase(hostname) {
    const explicit = String(process.env.AUTO_CREATE_DB || '').trim().toLowerCase();
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    return isLocalDbHost(hostname);
}

async function initializeDatabase() {
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = Number(process.env.DB_PORT || 3306);
    const dbName = process.env.DB_NAME || 'school_system';

    if (!shouldAutoCreateDatabase(dbHost)) {
        console.log('Skipping CREATE DATABASE on non-local/shared hosting.');
        return;
    }

    try {
        const connection = await mysql.createConnection({
            host: dbHost,
            port: dbPort,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || ''
        });

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        await connection.end();
    } catch (err) {
        console.warn('Database initialization warning:', err.message);
    }
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication token required.' });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);

        pruneActiveSessions();
        const sessionId = String(req.user?.sessionId || '').trim();
        const allowIfInactive = req.path === '/api/session/end';
        if (sessionId && !activeSessions.has(sessionId) && !allowIfInactive) {
            restoreActiveSessionFromToken(req);
        }

        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
}

function restoreActiveSessionFromToken(req) {
    const sessionId = String(req.user?.sessionId || '').trim();
    if (!sessionId) return;

    const role = req.user?.role || 'User';
    const userId = req.user?.id || req.user?.username || 'unknown';
    registerActiveSession(req, sessionId, {
        id: userId,
        fullName: req.user?.fullName || role,
        role,
        username: req.user?.username || String(userId),
        campusName: req.user?.campusName || ''
    });
}

function pruneActiveSessions() {
    const now = Date.now();
    activeSessions.forEach((session, sessionId) => {
        if (!session.lastSeen || now - session.lastSeen > ACTIVE_SESSION_TTL_MS) {
            activeSessions.delete(sessionId);
        }
    });
}

function createSessionId(role, id) {
    return `${String(role || 'user').toLowerCase()}_${String(id || '0')}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function registerActiveSession(req, sessionId, user) {
    if (!sessionId || !user) return;

    activeSessions.set(sessionId, {
        sessionId,
        userId: String(user.id || ''),
        username: user.username || '',
        fullName: user.fullName || '',
        role: user.role || '',
        campusName: user.campusName || '',
        loginAt: Date.now(),
        lastSeen: Date.now(),
        ip: req.ip || req.socket?.remoteAddress || '',
        userAgent: req.get('user-agent') || ''
    });
}

function buildActiveSessionsSummary() {
    pruneActiveSessions();
    const sessions = Array.from(activeSessions.values())
        .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
        .map((session) => ({
            ...session,
            loginAt: new Date(session.loginAt).toISOString(),
            lastSeen: new Date(session.lastSeen).toISOString()
        }));
    const byRole = sessions.reduce((acc, session) => {
        const role = session.role || 'Unknown';
        acc[role] = (acc[role] || 0) + 1;
        return acc;
    }, {});
    const uniqueUsers = new Set(sessions.map((session) => `${session.role}:${session.userId || session.username}`));
    const uniqueSessionMap = new Map();
    sessions.forEach((session) => {
        const key = `${session.role}:${session.userId || session.username}`;
        if (!uniqueSessionMap.has(key)) {
            uniqueSessionMap.set(key, session);
        }
    });
    const uniqueSessions = Array.from(uniqueSessionMap.values());

    return {
        success: true,
        totalActiveLogins: sessions.length,
        totalActiveSessions: sessions.length,
        uniqueActiveUsers: uniqueUsers.size,
        byRole,
        sessions,
        uniqueSessions
    };
}

function canManageActiveSessions(user = {}) {
    const role = String(user?.role || '').trim().toLowerCase();
    return role === 'admin'
        || role === 'superadmin'
        || role === 'super admin'
        || role === 'system administrator'
        || role === 'system_admin';
}

function readPermissions() {
    try {
        if (!fs.existsSync(PERMISSIONS_FILE)) {
            return writePermissions(defaultPermissions);
        }

        const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
        const saved = JSON.parse(raw);

        return normalizePermissionsConfig(saved);
    } catch (error) {
        return defaultPermissions;
    }
}

function writePermissions(data) {
    const nextPermissions = normalizePermissionsConfig(data);

    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(nextPermissions, null, 2), 'utf8');
    return nextPermissions;
}

function loadDetailedPermissions() {
    try {
        if (!fs.existsSync(DETAILED_PERMISSIONS_FILE)) {
            return { system: {}, designations: {} };
        }

        const raw = fs.readFileSync(DETAILED_PERMISSIONS_FILE, 'utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : { system: {}, designations: {} };
    } catch (error) {
        console.warn('Failed to load detailed permissions:', error.message);
        return { system: {}, designations: {} };
    }
}

function saveDetailedPermissions(data) {
    const payload = data && typeof data === 'object' ? data : {};
    fs.writeFileSync(DETAILED_PERMISSIONS_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function normalizeDesignationKey(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^_+|_+$/g, '');
}

function checkDesignationActionPermission(designationKey, moduleKey, actionKey) {
    const detailed = loadDetailedPermissions();
    const designation = detailed?.designations?.[designationKey];
    const allowed = designation?.actionPermissions?.[moduleKey]?.[actionKey] === true;
    return allowed;
}

async function resolveUserDesignationKey(user = {}) {
    if (!sequelize) return '';
    const role = String(user?.role || '').trim();
    const id = String(user?.id || '').trim();
    if (!id) return '';

    try {
        if (role === 'Teacher') {
            const teacher = await sequelize.models.Teacher.findByPk(id);
            return normalizeDesignationKey(teacher?.designation || 'teacher');
        }
        if (role === 'Staff') {
            const staff = await sequelize.models.Staff.findByPk(id);
            return normalizeDesignationKey(staff?.designation || 'staff');
        }
        return '';
    } catch (error) {
        console.warn('Failed to resolve user designation:', error.message);
        return '';
    }
}

async function enforceActionPermission(req, res, moduleKey, actionKey) {
    const role = String(req.user?.role || '').trim();

    if (role === 'Admin' || role === 'Principal') return true;
    if (role === 'Branch') {
        res.status(403).json({ success: false, message: 'Branch access denied.' });
        return false;
    }
    if (role === 'Student') {
        res.status(403).json({ success: false, message: 'Student access denied.' });
        return false;
    }

    if (role === 'Teacher' || role === 'Staff') {
        const designationKey = await resolveUserDesignationKey(req.user);
        if (!designationKey) {
            res.status(403).json({ success: false, message: 'Designation not set. Ask admin to assign a designation.' });
            return false;
        }

        const allowed = checkDesignationActionPermission(designationKey, moduleKey, actionKey);
        if (!allowed) {
            res.status(403).json({
                success: false,
                message: `Permission denied: ${designationKey} cannot ${actionKey} in ${moduleKey}.`
            });
            return false;
        }

        return true;
    }

    // Keep legacy behavior for other roles (e.g., Branch) unless explicitly restricted.
    return true;
}

function getDefaultAdminCredentials() {
    return {
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin123'
    };
}

function readAdminCredentials() {
    const defaults = getDefaultAdminCredentials();
    try {
        if (!fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
            return defaults;
        }

        const raw = fs.readFileSync(ADMIN_CREDENTIALS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const username = String(parsed?.username || '').trim();
        const password = String(parsed?.password || '');

        if (!username || !password) {
            return defaults;
        }

        return { username, password };
    } catch (_error) {
        return defaults;
    }
}

function writeAdminCredentials(data = {}) {
    const username = String(data.username || '').trim();
    const password = String(data.password || '');

    if (!username) {
        const error = new Error('Admin username is required.');
        error.statusCode = 400;
        throw error;
    }

    if (!password) {
        const error = new Error('Admin password is required.');
        error.statusCode = 400;
        throw error;
    }

    const next = { username, password };
    fs.writeFileSync(ADMIN_CREDENTIALS_FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function verifyAdminAccessToken(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
        const error = new Error('Admin access required.');
        error.statusCode = 401;
        throw error;
    }

    let user = null;
    try {
        user = jwt.verify(token, JWT_SECRET);
    } catch (_error) {
        const error = new Error('Admin access required.');
        error.statusCode = 401;
        throw error;
    }

    if (user.role !== 'Admin') {
        const error = new Error('Admin access required.');
        error.statusCode = 403;
        throw error;
    }

    return user;
}

app.get('/api/permissions', (req, res) => {
    res.json(readPermissions());
});

app.post('/api/permissions', (req, res) => {
    try {
        verifyAdminAccessToken(req);
        const saved = writePermissions(req.body || {});
        res.json({ success: true, permissions: saved });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to save permissions.' });
    }
});

app.get('/api/designation-permissions', authenticateToken, async (req, res) => {
    try {
        const designationParam = req.query?.designation;
        const actionParam = req.query?.action;
        const designationKey = normalizeDesignationKey(designationParam);

        if (designationKey && actionParam) {
            const [moduleKeyRaw, actionKeyRaw] = String(actionParam).split('.');
            const moduleKey = String(moduleKeyRaw || '').trim();
            const actionKey = String(actionKeyRaw || '').trim();
            const allowed = moduleKey && actionKey
                ? checkDesignationActionPermission(designationKey, moduleKey, actionKey)
                : false;
            return res.json({ allowed });
        }

        if (designationKey) {
            const detailed = loadDetailedPermissions();
            const perms = detailed?.designations?.[designationKey] || null;
            return res.json(perms || { key: designationKey, name: designationKey, description: '', actionPermissions: {} });
        }

        verifyAdminAccessToken(req);
        const detailed = loadDetailedPermissions();
        const designations = Object.entries(detailed?.designations || {}).map(([key, value]) => ({
            key,
            name: value?.name || key,
            description: value?.description || ''
        }));

        return res.json({
            designations,
            permissions: detailed?.designations || {}
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to load designation permissions.' });
    }
});

app.post('/api/designation-permissions', authenticateToken, (req, res) => {
    try {
        verifyAdminAccessToken(req);
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const incomingDesignations = body.permissions && typeof body.permissions === 'object'
            ? body.permissions
            : (body.designations && typeof body.designations === 'object' ? body.designations : null);

        const existing = loadDetailedPermissions();
        const next = incomingDesignations
            ? { ...(existing || {}), designations: incomingDesignations }
            : body;

        const saved = saveDetailedPermissions(next);
        const designations = Object.entries(saved?.designations || {}).map(([key, value]) => ({
            key,
            name: value?.name || key,
            description: value?.description || ''
        }));

        res.json({
            success: true,
            designations,
            permissions: saved?.designations || {}
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to save designation permissions.' });
    }
});

app.get('/api/admin-credentials', (req, res) => {
    try {
        verifyAdminAccessToken(req);
        const credentials = readAdminCredentials();
        res.json({ success: true, credentials: { username: credentials.username } });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to load admin credentials.' });
    }
});

app.post('/api/admin-credentials', (req, res) => {
    try {
        verifyAdminAccessToken(req);
        const current = readAdminCredentials();
        const nextUsername = String(req.body?.username || '').trim();
        const nextPassword = String(req.body?.password || '').trim();
        const saved = writeAdminCredentials({
            username: nextUsername || current.username,
            password: nextPassword || current.password
        });
        res.json({ success: true, credentials: { username: saved.username } });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Failed to save admin credentials.' });
    }
});

function normalizeDateSheetPayload(data = {}) {
    const raw = data && typeof data === 'object' ? data : {};
    const uploadedFile = raw.uploadedDateSheetFile && typeof raw.uploadedDateSheetFile === 'object'
        ? raw.uploadedDateSheetFile
        : {};
    const scheduleRows = Array.isArray(raw.scheduleRows)
        ? raw.scheduleRows.map((row) => ({
            subject: String(row.subject || '').trim(),
            className: String(row.className || '').trim(),
            examDate: String(row.examDate || '').trim(),
            startTime: String(row.startTime || '').trim(),
            endTime: String(row.endTime || '').trim()
        })).filter((row) => row.subject || row.className || row.examDate || row.startTime || row.endTime)
        : [];

    return {
        dateSheetSchoolName: String(raw.dateSheetSchoolName || '').trim(),
        dateSheetExamTitle: String(raw.dateSheetExamTitle || '').trim(),
        dateSheetSession: String(raw.dateSheetSession || '').trim(),
        dateSheetClassGroup: String(raw.dateSheetClassGroup || '').trim(),
        dateSheetCampus: String(raw.dateSheetCampus || '').trim(),
        dateSheetDefaultStart: String(raw.dateSheetDefaultStart || '').trim(),
        dateSheetInstructions: String(raw.dateSheetInstructions || '').trim(),
        uploadedDateSheetFile: {
            name: String(uploadedFile.name || '').trim(),
            type: String(uploadedFile.type || '').trim(),
            size: Number(uploadedFile.size) || 0,
            dataUrl: String(uploadedFile.dataUrl || '').trim()
        },
        scheduleRows,
        status: ['executed', 'hidden'].includes(raw.status) ? raw.status : 'draft',
        executedAt: raw.executedAt || (raw.status === 'executed' ? new Date().toISOString() : null),
        hiddenAt: raw.status === 'hidden' ? (raw.hiddenAt || new Date().toISOString()) : null,
        updatedAt: new Date().toISOString()
    };
}

function readDateSheet() {
    try {
        if (!fs.existsSync(DATE_SHEET_FILE)) return null;
        const saved = JSON.parse(fs.readFileSync(DATE_SHEET_FILE, 'utf8'));
        return normalizeDateSheetPayload(saved);
    } catch (error) {
        return null;
    }
}

function writeDateSheet(data) {
    const normalized = normalizeDateSheetPayload(data);
    fs.writeFileSync(DATE_SHEET_FILE, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function normalizeUploadedAssignment(raw = {}) {
    return {
        id: String(raw.id || `UPLOADED-ASG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        startDate: String(raw.startDate || '').trim(),
        dueDate: String(raw.dueDate || '').trim(),
        totalMarks: String(raw.totalMarks || '').trim(),
        passMarks: String(raw.passMarks || '').trim(),
        file: raw.file && typeof raw.file === 'object' ? {
            name: String(raw.file.name || '').trim(),
            type: String(raw.file.type || '').trim(),
            dataUrl: String(raw.file.dataUrl || '').trim()
        } : null,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString()
    };
}

function normalizeUploadedLecture(raw = {}) {
    return {
        id: String(raw.id || `LECTURE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || raw.branchName || raw.campus || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        title: String(raw.title || '').trim(),
        subject: String(raw.subject || '').trim(),
        url: String(raw.url || '').trim(),
        details: String(raw.details || '').trim(),
        file: raw.file && typeof raw.file === 'object' ? {
            name: String(raw.file.name || '').trim(),
            type: String(raw.file.type || '').trim(),
            dataUrl: String(raw.file.dataUrl || '').trim()
        } : null,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString()
    };
}

function normalizeStudentDiary(raw = {}) {
    return {
        id: String(raw.id || `DIARY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        campusName: String(raw.campusName || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        date: String(raw.date || '').trim(),
        title: String(raw.title || '').trim(),
        details: String(raw.details || '').trim(),
        file: raw.file || null,
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString()
    };
}

function normalizeStudentAssignmentSubmission(raw = {}) {
    return {
        id: String(raw.id || `ASG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        studentId: String(raw.studentId || '').trim(),
        studentCode: String(raw.studentCode || '').trim(),
        studentName: String(raw.studentName || 'Student').trim(),
        rollNo: String(raw.rollNo || '').trim(),
        campusName: String(raw.campusName || '').trim(),
        classGrade: String(raw.classGrade || '').trim(),
        sourceAssignmentId: String(raw.sourceAssignmentId || '').trim(),
        assignmentTitle: String(raw.assignmentTitle || '').trim(),
        subject: String(raw.subject || '').trim(),
        note: String(raw.note || '').trim(),
        fileName: String(raw.fileName || raw.file?.name || '').trim(),
        fileType: String(raw.fileType || raw.file?.type || '').trim(),
        fileData: String(raw.fileData || raw.file?.dataUrl || '').trim(),
        totalMarks: String(raw.totalMarks || '').trim(),
        passMarks: String(raw.passMarks || '').trim(),
        obtainedMarks: String(raw.obtainedMarks || '').trim(),
        resultStatus: String(raw.resultStatus || '').trim(),
        submittedAt: raw.submittedAt || new Date().toISOString(),
        status: String(raw.status || raw.resultStatus || 'Submitted').trim()
    };
}

function readJsonArrayFile(filePath, normalizer) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed.map(normalizer) : [];
    } catch (_error) {
        return [];
    }
}

function writeJsonArrayFile(filePath, items, normalizer) {
    const normalized = (Array.isArray(items) ? items : []).map(normalizer);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function readOnlineAdmissions() {
    try {
        if (!fs.existsSync(ONLINE_ADMISSIONS_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(ONLINE_ADMISSIONS_FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

function writeOnlineAdmissions(records = []) {
    fs.mkdirSync(MOBILE_STORE_DIR, { recursive: true });
    const normalized = Array.isArray(records) ? records : [];
    fs.writeFileSync(ONLINE_ADMISSIONS_FILE, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function readComplaints() {
    try {
        if (!fs.existsSync(COMPLAINTS_FILE)) return [];
        const parsed = JSON.parse(fs.readFileSync(COMPLAINTS_FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

function writeComplaints(records = []) {
    fs.mkdirSync(MOBILE_STORE_DIR, { recursive: true });
    const normalized = Array.isArray(records) ? records : [];
    fs.writeFileSync(COMPLAINTS_FILE, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function normalizeOnlineAdmission(payload = {}, existing = {}) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    const now = new Date().toISOString();
    return {
        ...existing,
        ...raw,
        id: String(raw.id || existing.id || `ADM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        studentName: String(raw.studentName ?? existing.studentName ?? '').trim(),
        parentName: String(raw.parentName ?? existing.parentName ?? '').trim(),
        className: String(raw.className ?? existing.className ?? '').trim(),
        phone: String(raw.phone ?? existing.phone ?? '').trim(),
        email: String(raw.email ?? existing.email ?? '').trim(),
        campus: String(raw.campus ?? existing.campus ?? '').trim(),
        studentAge: String(raw.studentAge ?? existing.studentAge ?? '').trim(),
        previousSchool: String(raw.previousSchool ?? existing.previousSchool ?? '').trim(),
        address: String(raw.address ?? existing.address ?? '').trim(),
        message: String(raw.message ?? existing.message ?? '').trim(),
        status: String(raw.status || existing.status || 'New').trim() || 'New',
        createdAt: existing.createdAt || raw.createdAt || now,
        updatedAt: now
    };
}

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

function normalizeComplaint(payload = {}, existing = {}) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    const now = new Date().toISOString();
    const thread = Array.isArray(raw.thread)
        ? raw.thread
        : (Array.isArray(existing.thread) ? existing.thread : []);

    return {
        ...existing,
        ...raw,
        id: String(raw.id || existing.id || `CMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        senderRole: normalizeComplaintRole(raw.senderRole || existing.senderRole),
        senderId: String(raw.senderId ?? existing.senderId ?? '').trim(),
        senderName: String(raw.senderName ?? existing.senderName ?? '').trim(),
        senderClass: String(raw.senderClass ?? existing.senderClass ?? '').trim(),
        campusName: String(raw.campusName ?? existing.campusName ?? '').trim(),
        subject: String(raw.subject ?? existing.subject ?? '').trim(),
        message: String(raw.message ?? existing.message ?? '').trim(),
        status: normalizeComplaintStatus(raw.status || existing.status || 'Pending'),
        thread,
        reply: String(raw.reply ?? existing.reply ?? '').trim(),
        actionTaken: String(raw.actionTaken ?? existing.actionTaken ?? '').trim(),
        actionAt: raw.actionAt || existing.actionAt || null,
        repliedAt: raw.repliedAt || existing.repliedAt || null,
        file: raw.file || existing.file || null,
        createdAt: existing.createdAt || raw.createdAt || now,
        updatedAt: now
    };
}

app.get('/api/date-sheet', (req, res) => {
    res.json({ success: true, dateSheet: readDateSheet() });
});

app.post('/api/date-sheet', (req, res) => {
    try {
        const saved = writeDateSheet(req.body || {});
        io.emit('date_sheet_update', saved);
        res.json({ success: true, dateSheet: saved });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Date sheet could not be executed.' });
    }
});

app.get('/api/uploaded-assignments', (req, res) => {
    res.json({ success: true, assignments: readJsonArrayFile(UPLOADED_ASSIGNMENTS_FILE, normalizeUploadedAssignment) });
});

app.post('/api/uploaded-assignments', (req, res) => {
    const item = normalizeUploadedAssignment(req.body || {});
    if (!item.campusName || !item.classGrade || !item.startDate || !item.dueDate || !item.totalMarks || !item.passMarks || !item.file?.dataUrl) {
        return res.status(400).json({ success: false, message: 'Campus, class, dates, marks, and file are required.' });
    }
    const existing = readJsonArrayFile(UPLOADED_ASSIGNMENTS_FILE, normalizeUploadedAssignment);
    const assignments = writeJsonArrayFile(UPLOADED_ASSIGNMENTS_FILE, [item, ...existing.filter((entry) => String(entry.id) !== String(item.id))], normalizeUploadedAssignment);
    res.json({ success: true, assignment: item, assignments });
});

app.delete('/api/uploaded-assignments', (req, res) => {
    const id = String(req.query.id || '');
    const assignments = writeJsonArrayFile(UPLOADED_ASSIGNMENTS_FILE, readJsonArrayFile(UPLOADED_ASSIGNMENTS_FILE, normalizeUploadedAssignment).filter((entry) => String(entry.id) !== id), normalizeUploadedAssignment);
    res.json({ success: true, assignments });
});

app.get('/api/uploaded-lectures', (req, res) => {
    res.json({ success: true, lectures: readJsonArrayFile(UPLOADED_LECTURES_FILE, normalizeUploadedLecture) });
});

app.post('/api/uploaded-lectures', (req, res) => {
    const item = normalizeUploadedLecture(req.body || {});
    if (!item.campusName || !item.classGrade || !item.title || !item.details) {
        return res.status(400).json({ success: false, message: 'Campus, class, title, and notes are required.' });
    }
    const existing = readJsonArrayFile(UPLOADED_LECTURES_FILE, normalizeUploadedLecture);
    const lectures = writeJsonArrayFile(UPLOADED_LECTURES_FILE, [item, ...existing.filter((entry) => String(entry.id) !== String(item.id))], normalizeUploadedLecture);
    res.json({ success: true, lecture: item, lectures });
});

app.delete('/api/uploaded-lectures', (req, res) => {
    const id = String(req.query.id || '');
    const lectures = writeJsonArrayFile(UPLOADED_LECTURES_FILE, readJsonArrayFile(UPLOADED_LECTURES_FILE, normalizeUploadedLecture).filter((entry) => String(entry.id) !== id), normalizeUploadedLecture);
    res.json({ success: true, lectures });
});

app.get('/api/student-diaries', (req, res) => {
    res.json({ success: true, diaries: readJsonArrayFile(STUDENT_DIARIES_FILE, normalizeStudentDiary) });
});

app.post('/api/student-diaries', (req, res) => {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : [req.body].filter(Boolean);
    const records = incoming.map(normalizeStudentDiary).filter((item) => item.campusName && item.classGrade && item.date && item.title && item.details);
    if (!records.length) {
        return res.status(400).json({ success: false, message: 'Campus, class, date, subject, and diary details are required.' });
    }
    const existing = readJsonArrayFile(STUDENT_DIARIES_FILE, normalizeStudentDiary);
    const ids = new Set(records.map((item) => String(item.id)));
    const diaries = writeJsonArrayFile(STUDENT_DIARIES_FILE, [...records, ...existing.filter((entry) => !ids.has(String(entry.id)))], normalizeStudentDiary);
    res.json({ success: true, diaries, saved: records });
});

app.delete('/api/student-diaries', (req, res) => {
    const id = String(req.query.id || '');
    const diaries = writeJsonArrayFile(STUDENT_DIARIES_FILE, readJsonArrayFile(STUDENT_DIARIES_FILE, normalizeStudentDiary).filter((entry) => String(entry.id) !== id), normalizeStudentDiary);
    res.json({ success: true, diaries });
});

app.get('/api/student-assignments', (req, res) => {
    const assignments = readJsonArrayFile(STUDENT_ASSIGNMENT_SUBMISSIONS_FILE, normalizeStudentAssignmentSubmission)
        .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    res.json({ success: true, assignments });
});

app.post('/api/student-assignments', (req, res) => {
    const record = normalizeStudentAssignmentSubmission(req.body || {});
    if (!record.assignmentTitle) {
        return res.status(400).json({ success: false, message: 'Assignment title is required.' });
    }
    const existing = readJsonArrayFile(STUDENT_ASSIGNMENT_SUBMISSIONS_FILE, normalizeStudentAssignmentSubmission);
    const assignments = writeJsonArrayFile(STUDENT_ASSIGNMENT_SUBMISSIONS_FILE, [record, ...existing.filter((entry) => String(entry.id) !== String(record.id))], normalizeStudentAssignmentSubmission)
        .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    res.json({ success: true, assignment: record, assignments });
});

app.get('/api/online-admissions', (req, res) => {
    res.json({ success: true, applications: readOnlineAdmissions() });
});

app.post('/api/online-admissions', (req, res) => {
    try {
        const payload = req.body || {};
        const required = ['studentName', 'parentName', 'className', 'phone'];
        const missing = required.find((key) => !String(payload[key] || '').trim());
        if (missing) {
            return res.status(400).json({ success: false, message: 'Student name, parent name, class, and phone are required.' });
        }

        const applications = readOnlineAdmissions();
        const application = normalizeOnlineAdmission(payload);
        applications.unshift(application);
        const saved = writeOnlineAdmissions(applications);
        if (io) io.emit('online_admissions_update', saved);
        return res.json({ success: true, application, applications: saved });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Application could not be submitted.' });
    }
});

app.post('/api/online-admissions/:id', (req, res) => {
    try {
        const applications = readOnlineAdmissions();
        const index = applications.findIndex((item) => String(item.id) === String(req.params.id));
        if (index < 0) return res.status(404).json({ success: false, message: 'Application not found.' });

        applications[index] = normalizeOnlineAdmission(req.body || {}, applications[index]);
        const saved = writeOnlineAdmissions(applications);
        if (io) io.emit('online_admissions_update', saved);
        return res.json({ success: true, application: applications[index], applications: saved });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Application could not be updated.' });
    }
});

app.delete('/api/online-admissions/:id', (req, res) => {
    const applications = writeOnlineAdmissions(readOnlineAdmissions().filter((item) => String(item.id) !== String(req.params.id)));
    if (io) io.emit('online_admissions_update', applications);
    res.json({ success: true, deleted: true, applications });
});

app.get('/api/complaints', (req, res) => {
    const role = String(req.query.role || '').trim();
    const senderRole = role ? normalizeComplaintRole(role) : '';
    const complaints = readComplaints()
        .filter((item) => !senderRole || normalizeComplaintRole(item.senderRole) === senderRole)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    res.json({ success: true, complaints });
});

app.post('/api/complaints', (req, res) => {
    try {
        const payload = req.body || {};
        const subject = String(payload.subject || '').trim();
        const message = String(payload.message || '').trim();
        const senderRole = normalizeComplaintRole(payload.senderRole);

        if (!subject || !message) {
            return res.status(400).json({ success: false, message: 'Subject and message are required.' });
        }
        if (senderRole === 'Family' && !String(payload.senderName || '').trim()) {
            return res.status(400).json({ success: false, message: 'Family complainant name is required.' });
        }

        const complaints = readComplaints();
        const complaint = normalizeComplaint({ ...payload, senderRole });
        complaints.unshift(complaint);
        const saved = writeComplaints(complaints);
        if (io) io.emit('complaints_update', saved);
        return res.json({ success: true, complaint, complaints: saved });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Complaint could not be submitted.' });
    }
});

app.post('/api/complaints/:id', (req, res) => {
    try {
        const complaints = readComplaints();
        const index = complaints.findIndex((item) => String(item.id) === String(req.params.id));
        if (index < 0) return res.status(404).json({ success: false, message: 'Complaint not found.' });

        const payload = req.body || {};
        const reply = String(payload.reply || '').trim();
        const thread = Array.isArray(complaints[index].thread) ? [...complaints[index].thread] : [];
        const now = new Date().toISOString();

        if (reply) {
            thread.push({
                role: String(payload.replyRole || 'Admin').trim() || 'Admin',
                name: String(payload.replyName || 'Admin').trim() || 'Admin',
                message: reply,
                createdAt: now
            });
        }

        complaints[index] = normalizeComplaint({
            ...payload,
            ...(reply ? { thread, repliedAt: now } : {})
        }, complaints[index]);

        const saved = writeComplaints(complaints);
        if (io) io.emit('complaints_update', saved);
        return res.json({ success: true, complaint: complaints[index], complaints: saved });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Complaint could not be updated.' });
    }
});

app.delete('/api/complaints/:id', (req, res) => {
    const complaints = writeComplaints(readComplaints().filter((item) => String(item.id) !== String(req.params.id)));
    if (io) io.emit('complaints_update', complaints);
    res.json({ success: true, deleted: true, complaints });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const adminCredentials = readAdminCredentials();
        const adminUsername = adminCredentials.username;
        const adminPass = adminCredentials.password;

        if (username === adminUsername && password === adminPass) {
            const permissions = readPermissions();
            const groupKey = permissions.roleGroups.Admin || 'admin';
            const sessionId = createSessionId('Admin', 'admin');
            const token = jwt.sign({ id: 'admin', role: 'Admin', sessionId }, JWT_SECRET, { expiresIn: '1d' });
            const user = { id: 'admin', fullName: 'Administrator', role: 'Admin', username: adminUsername, groupKey };
            registerActiveSession(req, sessionId, user);
            return res.json({
                success: true,
                token,
                sessionId,
                permissions,
                user
            });
        }

        if (username === PRINCIPAL_USERNAME && password === PRINCIPAL_PASSWORD) {
            const permissions = readPermissions();
            if (permissions.loginAccess.principal === false) {
                return res.status(403).json({ success: false, message: 'Principal login is currently disabled by admin.' });
            }
            const groupKey = permissions.roleGroups.Principal || 'principal';
            const sessionId = createSessionId('Principal', 'principal');
            const token = jwt.sign({ id: 'principal', role: 'Principal', sessionId }, JWT_SECRET, { expiresIn: '1d' });
            const user = { id: 'principal', fullName: 'Principal', role: 'Principal', username: PRINCIPAL_USERNAME, groupKey };
            registerActiveSession(req, sessionId, user);
            return res.json({
                success: true,
                token,
                sessionId,
                permissions,
                user
            });
        }

        if (!sequelize) {
            return res.status(503).json({ success: false, message: 'Database is offline. Only Admin can log in.' });
        }

        const normalizedIdentity = String(username || '').trim();
        const userWhere = {
            [Op.or]: [
                { username: normalizedIdentity }
            ]
        };

        if (normalizedIdentity.includes('@')) {
            userWhere[Op.or].push({ email: normalizedIdentity.toLowerCase() });
        }

        const User = sequelize.models.User;
        const Student = sequelize.models.Student;
        const Teacher = sequelize.models.Teacher;
        const user = await User.findOne({ where: userWhere });

        if (user) {
            const permissions = readPermissions();
            const roleKey = String(user.role || '').toLowerCase();
            if (permissions.loginAccess[roleKey] === false) {
                return res.status(403).json({ success: false, message: `${user.role} login is currently disabled by admin.` });
            }

            const isMatch = await bcrypt.compare(password, user.password);

            if (isMatch) {
                let profileName = user.fullName;
                let designationKey = '';

                if (user.role === 'Student') {
                    const student = await Student.findByPk(user.profileId);
                    profileName = student?.fullName || profileName;
                } else if (user.role === 'Teacher') {
                    const teacher = await Teacher.findByPk(user.profileId);
                    profileName = teacher?.fullName || profileName;
                    designationKey = normalizeDesignationKey(teacher?.designation || 'teacher');
                } else if (user.role === 'Staff') {
                    const staff = await sequelize.models.Staff.findByPk(user.profileId);
                    profileName = staff?.fullName || profileName;
                    designationKey = normalizeDesignationKey(staff?.designation || 'staff');
                }

                const sessionId = createSessionId(user.role, user.profileId);
                const token = jwt.sign({ id: user.profileId, role: user.role, campusName: user.campusName || '', sessionId }, JWT_SECRET, { expiresIn: '1d' });
                const responseUser = {
                    id: user.profileId,
                    fullName: profileName,
                    role: user.role,
                    username: user.username,
                    campusName: user.campusName || '',
                    groupKey: user.groupKey || permissions.roleGroups[user.role] || roleKey,
                    ...(designationKey ? { designation: designationKey } : {})
                };
                registerActiveSession(req, sessionId, responseUser);
                return res.json({
                    success: true,
                    token,
                    sessionId,
                    permissions,
                    user: responseUser
                });
            }
        }

        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/session/heartbeat', authenticateToken, (req, res) => {
    const sessionId = req.user.sessionId;
    if (!sessionId) {
        return res.status(400).json({ success: false, message: 'Session id missing.' });
    }

    const existing = activeSessions.get(sessionId);
    activeSessions.set(sessionId, {
        ...(existing || {}),
        sessionId,
        userId: String(req.user.id || existing?.userId || ''),
        role: req.user.role || existing?.role || '',
        campusName: req.user.campusName || existing?.campusName || '',
        loginAt: existing?.loginAt || Date.now(),
        lastSeen: Date.now(),
        ip: req.ip || req.socket?.remoteAddress || existing?.ip || '',
        userAgent: req.get('user-agent') || existing?.userAgent || ''
    });

    res.json({ success: true });
});

app.post('/api/session/end', authenticateToken, (req, res) => {
    if (req.user.sessionId) {
        activeSessions.delete(req.user.sessionId);
    }

    res.json({ success: true });
});

app.get('/api/active-sessions', authenticateToken, (req, res) => {
    if (!canManageActiveSessions(req.user)) {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    res.json(buildActiveSessionsSummary());
});

app.delete('/api/active-sessions/:sessionId', authenticateToken, (req, res) => {
    if (!canManageActiveSessions(req.user)) {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const targetSessionId = decodeURIComponent(String(req.params.sessionId || '').trim());
    if (!targetSessionId) {
        return res.status(400).json({ success: false, message: 'Session id is required.' });
    }

    const hadSession = activeSessions.delete(targetSessionId);
    if (hadSession) {
        io.emit('session_forced_logout', { sessionId: targetSessionId });
    }
    return res.json({
        success: true,
        message: hadSession ? 'Session has been logged out.' : 'Session was already inactive.'
    });
});

app.post('/api/active-sessions/logout', authenticateToken, (req, res) => {
    if (!canManageActiveSessions(req.user)) {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const targetSessionId = decodeURIComponent(String(req.body?.sessionId || '').trim());
    if (!targetSessionId) {
        return res.status(400).json({ success: false, message: 'Session id is required.' });
    }

    const hadSession = activeSessions.delete(targetSessionId);
    if (hadSession) {
        io.emit('session_forced_logout', { sessionId: targetSessionId });
    }
    return res.json({
        success: true,
        message: hadSession ? 'Session has been logged out.' : 'Session was already inactive.'
    });
});

app.get('/api/students', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const students = await sequelize.models.Student.findAll();
        res.json(students);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function normalizeClassFeeRecords(records = []) {
    const input = Array.isArray(records) ? records : [];
    const byClass = new Map();

    input.forEach((record) => {
        const className = String(record?.className || record?.name || '').trim();
        if (!className) return;
        const key = className.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
        byClass.set(key, {
            id: record?.id || key,
            className,
            monthlyFee: Number(record?.monthlyFee || record?.amount || 0) || 0,
            feeFrequency: String(record?.feeFrequency || 'Monthly').trim() || 'Monthly',
            updatedAtLabel: record?.updatedAtLabel || new Date().toLocaleString('en-GB')
        });
    });

    return Array.from(byClass.values());
}

app.get('/api/class-fees', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const rows = await sequelize.models.ClassFee.findAll({ order: [['className', 'ASC']] });
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/class-fees', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const ok = await enforceActionPermission(req, res, 'fees', 'edit');
        if (!ok) return;

        const ClassFee = sequelize.models.ClassFee;
        const records = normalizeClassFeeRecords(Array.isArray(req.body) ? req.body : [req.body]);

        await ClassFee.destroy({ where: {} });
        for (const record of records) {
            await ClassFee.upsert(record);
        }

        const allRecords = await ClassFee.findAll({ order: [['className', 'ASC']] });
        io.emit('class_fees_update', allRecords);
        res.json({ success: true, classFees: allRecords });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

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

async function getUserMessageProfile(user = {}) {
    const role = normalizeMessageRole(user.role);
    const id = String(user.id || '').trim();
    if (!role || !id) return { role, id };

    if (role === 'Student') {
        const student = await sequelize.models.Student.findByPk(id);
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
        const teacher = await sequelize.models.Teacher.findByPk(id);
        return {
            role,
            id,
            username: user.username || teacher?.username || '',
            fullName: teacher?.fullName || user.fullName || '',
            campusName: teacher?.campusName || user.campusName || ''
        };
    }

    const staff = await sequelize.models.Staff.findByPk(id);
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

app.get('/api/messages', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const role = normalizeMessageRole(req.user?.role);
        let records = await sequelize.models.Message.findAll({ order: [['createdAt', 'DESC']] });
        let messages = records.map(formatMessageRecord);

        if (!['Admin', 'Principal'].includes(String(req.user?.role || ''))) {
            const profile = await getUserMessageProfile(req.user);
            messages = messages.filter((message) => messageMatchesProfile(message, profile));
        } else if (req.query.role) {
            const targetRole = normalizeMessageRole(req.query.role);
            messages = targetRole ? messages.filter((message) => message.targetRole === targetRole) : messages;
        }

        res.json({ success: true, role, messages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const payload = req.body || {};
        const action = String(payload.action || '').trim().toLowerCase();
        if (action === 'reply' || action === 'end') {
            const id = String(payload.id || payload.messageId || '').trim();
            const record = id ? await sequelize.models.Message.findByPk(id) : null;
            if (!record) return res.status(404).json({ success: false, message: 'Message not found.' });

            const message = formatMessageRecord(record);
            if (action === 'end') {
                if (!['Admin', 'Principal'].includes(String(req.user?.role || ''))) {
                    return res.status(403).json({ success: false, message: 'Admin access required.' });
                }
                await record.update({ chatStatus: 'ended' });
            } else {
                if (message.chatStatus === 'ended') {
                    return res.status(400).json({ success: false, message: 'This chat has ended.' });
                }
                if (!['Admin', 'Principal'].includes(String(req.user?.role || ''))) {
                    const profile = await getUserMessageProfile(req.user);
                    if (!messageMatchesProfile(message, profile)) {
                        return res.status(403).json({ success: false, message: 'You cannot reply to this message.' });
                    }
                }
                const replyText = String(payload.reply || payload.body || '').trim();
                if (!replyText) return res.status(400).json({ success: false, message: 'Reply is required.' });
                const nextThread = [
                    ...message.thread,
                    {
                        role: ['Admin', 'Principal'].includes(String(req.user?.role || '')) ? 'Admin' : String(req.user?.role || 'User'),
                        name: req.user.fullName || req.user.username || req.user.role || 'User',
                        message: replyText,
                        createdAt: new Date().toISOString()
                    }
                ];
                await record.update({ thread: JSON.stringify(nextThread), chatStatus: 'open' });
            }

            const records = await sequelize.models.Message.findAll({ order: [['createdAt', 'DESC']] });
            const messages = records.map(formatMessageRecord);
            io.emit('messages_update', messages);
            return res.json({ success: true, message: formatMessageRecord(await sequelize.models.Message.findByPk(id)), messages });
        }

        if (!['Admin', 'Principal'].includes(String(req.user?.role || ''))) {
            return res.status(403).json({ success: false, message: 'Admin access required.' });
        }

        const targetRole = normalizeMessageRole(payload.targetRole);
        const targetScope = normalizeMessageScope(payload.targetScope);
        const subject = String(payload.subject || '').trim();
        const body = String(payload.body || '').trim();
        const campusName = String(payload.campusName || '').trim();
        const classGrade = String(payload.classGrade || '').trim();
        const recipientId = String(payload.recipientId || '').trim();

        if (!targetRole || !targetScope || !subject || !body) {
            return res.status(400).json({ success: false, message: 'Role, scope, subject, and message are required.' });
        }
        if (targetScope === 'campus' && !campusName) {
            return res.status(400).json({ success: false, message: 'Select campus for campus message.' });
        }
        if (targetScope === 'class' && (!campusName || !classGrade || targetRole !== 'Student')) {
            return res.status(400).json({ success: false, message: 'Class messages require Student role, campus, and class.' });
        }
        if (targetScope === 'individual' && !recipientId) {
            return res.status(400).json({ success: false, message: 'Select a recipient for individual message.' });
        }

        const message = {
            id: payload.id || `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            subject,
            body,
            targetRole,
            targetScope,
            campusName: campusName || null,
            classGrade: classGrade || null,
            recipientId: recipientId || null,
            recipientName: String(payload.recipientName || '').trim() || null,
            senderName: req.user.fullName || req.user.username || 'Admin',
            thread: JSON.stringify([]),
            chatStatus: 'open',
            createdAtLabel: new Date().toLocaleString('en-GB')
        };

        await sequelize.models.Message.create(message);
        const records = await sequelize.models.Message.findAll({ order: [['createdAt', 'DESC']] });
        const messages = records.map(formatMessageRecord);
        io.emit('messages_update', messages);
        res.json({ success: true, message: formatMessageRecord(message), messages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

function normalizeNoticeTargets(targetPortals) {
    const allowedTargets = new Set(['student', 'teacher', 'staff']);
    const targets = Array.isArray(targetPortals) ? targetPortals : [];
    return [...new Set(targets.map((target) => String(target || '').toLowerCase()).filter((target) => allowedTargets.has(target)))];
}

function serializeNoticeTargets(targets) {
    return JSON.stringify(normalizeNoticeTargets(targets));
}

function formatSpecialNotice(record) {
    const raw = record && typeof record.toJSON === 'function' ? record.toJSON() : record;
    let targetPortals = [];
    if (Array.isArray(raw.targetPortals)) {
        targetPortals = raw.targetPortals;
    } else {
        try {
            targetPortals = JSON.parse(raw.targetPortals || '[]');
        } catch (error) {
            targetPortals = [];
        }
    }
    return {
        ...raw,
        targetPortals: normalizeNoticeTargets(targetPortals)
    };
}

app.get('/api/special-notices', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const portal = String(req.query.portal || '').toLowerCase();
        const where = portal ? { status: 'executed' } : {};
        const records = await sequelize.models.SpecialNotice.findAll({
            where,
            order: [['updatedAt', 'DESC']]
        });
        const notices = records.map(formatSpecialNotice)
            .filter((notice) => !portal || notice.targetPortals.includes(portal));
        res.json({ success: true, notices });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/special-notices', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const payload = req.body || {};
        const title = String(payload.title || '').trim();
        const message = String(payload.message || '').trim();
        const targetPortals = normalizeNoticeTargets(payload.targetPortals);
        const status = payload.status === 'executed' ? 'executed' : 'draft';

        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Notice title and message are required.' });
        }

        if (status === 'executed' && !targetPortals.length) {
            return res.status(400).json({ success: false, message: 'Select at least one portal before executing.' });
        }

        const id = payload.id || `NOTICE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const notice = {
            id,
            title,
            message,
            targetPortals: serializeNoticeTargets(targetPortals),
            status,
            executedAt: status === 'executed' ? (payload.executedAt || new Date()) : null,
            createdAtLabel: payload.createdAtLabel || new Date().toLocaleString('en-GB')
        };

        await sequelize.models.SpecialNotice.upsert(notice);

        const records = await sequelize.models.SpecialNotice.findAll({
            order: [['updatedAt', 'DESC']]
        });
        const notices = records.map(formatSpecialNotice);
        io.emit('special_notices_update', notices);
        res.json({ success: true, notice: formatSpecialNotice(notice), notices });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/special-notices/:id', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const deletedCount = await sequelize.models.SpecialNotice.destroy({ where: { id: req.params.id } });
        const records = await sequelize.models.SpecialNotice.findAll({
            order: [['updatedAt', 'DESC']]
        });
        const notices = records.map(formatSpecialNotice);
        io.emit('special_notices_update', notices);

        res.json({
            success: true,
            deleted: deletedCount > 0,
            notices
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

function normalizeBannerPlacement(value) {
    return String(value || '').trim().toLowerCase() === 'ad' ? 'ad' : 'banner';
}

function formatBanner(record) {
    const raw = record && typeof record.toJSON === 'function' ? record.toJSON() : record;
    return {
        ...raw,
        placement: normalizeBannerPlacement(raw?.placement),
        displayOrder: Number(raw?.displayOrder || 0),
        isActive: raw?.isActive !== false
    };
}

app.get('/api/banners', async (_req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const placement = normalizeBannerPlacement(_req.query?.placement);
        const where = _req.query?.placement ? { placement } : undefined;
        const records = await sequelize.models.Banner.findAll({
            where,
            order: [['displayOrder', 'ASC'], ['updatedAt', 'DESC']]
        });
        res.json({ success: true, banners: records.map(formatBanner) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/banners', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const payload = req.body || {};
        const title = String(payload.title || '').trim();
        const imageUrl = String(payload.imageUrl || '').trim();

        if (!title || !imageUrl) {
            return res.status(400).json({ success: false, message: 'Banner title and image are required.' });
        }

        const banner = {
            id: payload.id || `BANNER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title,
            subtitle: String(payload.subtitle || '').trim(),
            imageUrl,
            linkUrl: String(payload.linkUrl || '').trim(),
            placement: normalizeBannerPlacement(payload.placement),
            displayOrder: Number(payload.displayOrder || 0),
            isActive: payload.isActive !== false
        };

        await sequelize.models.Banner.upsert(banner);
        const records = await sequelize.models.Banner.findAll({
            order: [['displayOrder', 'ASC'], ['updatedAt', 'DESC']]
        });
        const banners = records.map(formatBanner);
        io.emit('banners_update', banners);
        res.json({ success: true, banner: formatBanner(banner), banners });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/banners/:id', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const deletedCount = await sequelize.models.Banner.destroy({ where: { id: req.params.id } });
        const records = await sequelize.models.Banner.findAll({
            order: [['displayOrder', 'ASC'], ['updatedAt', 'DESC']]
        });
        const banners = records.map(formatBanner);
        io.emit('banners_update', banners);
        res.json({ success: true, deleted: deletedCount > 0, banners });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/reset-data', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    if (!sequelize) {
        return res.status(503).json({ success: false, message: 'Database offline' });
    }

    try {
        const models = sequelize.models;
        const resetOrder = [
            'FeePayment',
            'StudentAttendance',
            'TeacherAttendance',
            'SpecialNotice',
            'Message',
            'ClassFee',
            'Student',
            'Teacher',
            'Staff',
            'User'
        ];

        for (const modelName of resetOrder) {
            if (models[modelName]) {
                await models[modelName].destroy({ where: {} });
            }
        }

        writePermissions(defaultPermissions);
        activeSessions.clear();

        io.emit('students_update', []);
        io.emit('teachers_update', []);
        io.emit('staff_update', []);
        io.emit('special_notices_update', []);
        io.emit('messages_update', []);

        res.json({ success: true, message: 'System data has been reset.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/branches', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const branches = await sequelize.models.User.findAll({
            where: { role: 'Branch' },
            attributes: ['id', 'profileId', 'fullName', 'username', 'plainPassword', 'campusName', 'isActive'],
            order: [['campusName', 'ASC']]
        });
        res.json(branches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/branches', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const User = sequelize.models.User;
        const data = Array.isArray(req.body) ? req.body : [req.body];

        for (const item of data) {
            if (!item.username || !item.campusName) {
                return res.status(400).json({ success: false, message: 'Campus name and username are required.' });
            }

            const branchId = item.profileId || item.id || `branch_${String(item.campusName).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
            const existingBranch = item.id ? await User.findByPk(item.id) : await User.findOne({ where: { id: branchId, role: 'Branch' } });
            const rawPassword = item.plainPassword || item.password || existingBranch?.plainPassword || '';

            if (!rawPassword) {
                return res.status(400).json({ success: false, message: 'Password is required.' });
            }

            const passwordHash = item.password
                ? (isPasswordHash(item.password) ? item.password : await bcrypt.hash(item.password, 10))
                : existingBranch?.password;

            await User.upsert({
                id: item.id || branchId,
                profileId: branchId,
                fullName: item.fullName || item.campusName,
                email: normalizeOptionalEmail(item.email),
                username: item.username,
                password: passwordHash,
                plainPassword: rawPassword,
                role: 'Branch',
                campusName: item.campusName,
                isActive: item.isActive !== false
            });
        }

        const branches = await User.findAll({
            where: { role: 'Branch' },
            attributes: ['id', 'profileId', 'fullName', 'username', 'plainPassword', 'campusName', 'isActive'],
            order: [['campusName', 'ASC']]
        });

        res.json({ success: true, branches });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/branches/:id', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const deletedCount = await sequelize.models.User.destroy({
            where: {
                id: req.params.id,
                role: 'Branch'
            }
        });

        if (!deletedCount) {
            return res.status(404).json({ success: false, message: 'Branch not found.' });
        }

        res.json({ success: true, message: 'Branch deleted successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/student/me', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Student') {
        return res.status(403).json({ success: false, message: 'Student access only.' });
    }

    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const student = await sequelize.models.Student.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student record not found.' });
        }

        return res.json(student);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/student/me', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Student') {
        return res.status(403).json({ success: false, message: 'Student access only.' });
    }

    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const profileImage = String(req.body?.profileImage || '').trim();
        if (!profileImage || !profileImage.startsWith('data:image/')) {
            return res.status(400).json({ success: false, message: 'A profile image is required.' });
        }

        const student = await sequelize.models.Student.findByPk(req.user.id);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student record not found.' });
        }

        await student.update({ profileImage });
        const refreshed = await sequelize.models.Student.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });
        return res.json({ success: true, student: refreshed });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/teacher/me', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Teacher') {
        return res.status(403).json({ success: false, message: 'Teacher access only.' });
    }

    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const teacher = await sequelize.models.Teacher.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });

        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Teacher record not found.' });
        }

        return res.json(teacher);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/teacher/me', authenticateToken, async (req, res) => {
    if (req.user.role !== 'Teacher') {
        return res.status(403).json({ success: false, message: 'Teacher access only.' });
    }

    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const profileImage = String(req.body?.profileImage || '').trim();
        if (!profileImage || !profileImage.startsWith('data:image/')) {
            return res.status(400).json({ success: false, message: 'A profile image is required.' });
        }

        const teacher = await sequelize.models.Teacher.findByPk(req.user.id);
        if (!teacher) {
            return res.status(404).json({ success: false, message: 'Teacher record not found.' });
        }

        await teacher.update({ profileImage });
        const refreshed = await sequelize.models.Teacher.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });
        return res.json({ success: true, teacher: refreshed });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

function formatLeaveRequest(record) {
    const raw = record && typeof record.toJSON === 'function' ? record.toJSON() : record;
    return {
        ...raw,
        applicantRole: String(raw?.applicantRole || '').trim(),
        applicantId: String(raw?.applicantId || '').trim(),
        applicantName: String(raw?.applicantName || '').trim(),
        status: String(raw?.status || '').trim() || 'Pending'
    };
}

function canReviewLeaveRequests(user = {}) {
    return !['Student', 'Teacher'].includes(String(user.role || '').trim());
}

function getOwnLeaveWhere(user = {}) {
    if (user.role === 'Student') return { applicantRole: 'Student', applicantId: String(user.id || '').trim() };
    if (user.role === 'Teacher') return { applicantRole: 'Teacher', applicantId: String(user.id || '').trim() };
    return {};
}

async function resolveLeaveApplicant(user) {
    if (user.role === 'Student') {
        const student = await sequelize.models.Student.findByPk(user.id);
        if (!student) {
            const error = new Error('Student record not found.');
            error.statusCode = 404;
            throw error;
        }
        return {
            applicantRole: 'Student',
            applicantId: String(student.id || '').trim(),
            applicantName: student.fullName || user.fullName || 'Student',
            email: student.email || user.email || '',
            studentCode: student.studentCode || '',
            rollNo: student.rollNo || '',
            classGrade: student.classGrade || '',
            campusName: student.campusName || user.campusName || ''
        };
    }

    if (user.role === 'Teacher') {
        const teacher = await sequelize.models.Teacher.findByPk(user.id);
        if (!teacher) {
            const error = new Error('Teacher record not found.');
            error.statusCode = 404;
            throw error;
        }
        return {
            applicantRole: 'Teacher',
            applicantId: String(teacher.id || '').trim(),
            applicantName: teacher.fullName || user.fullName || 'Teacher',
            email: teacher.email || user.email || '',
            subject: teacher.subject || '',
            campusName: teacher.campusName || user.campusName || ''
        };
    }

    const error = new Error('Student or teacher portal access required.');
    error.statusCode = 403;
    throw error;
}

app.get('/api/leave-requests', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const role = String(req.query?.role || '').trim();
        const where = getOwnLeaveWhere(req.user);
        if (canReviewLeaveRequests(req.user) && ['Student', 'Teacher'].includes(role)) {
            where.applicantRole = role;
        }

        const records = await sequelize.models.LeaveRequest.findAll({
            where,
            order: [['createdAt', 'DESC']]
        });
        return res.json({ success: true, leaveRequests: records.map(formatLeaveRequest) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/leave-requests', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const fromDate = String(req.body?.fromDate || '').trim();
        const toDate = String(req.body?.toDate || '').trim();
        const reason = String(req.body?.reason || '').trim();
        if (!fromDate || !toDate || !reason) {
            return res.status(400).json({ success: false, message: 'Leave dates and reason are required.' });
        }
        if (toDate < fromDate) {
            return res.status(400).json({ success: false, message: 'Leave end date cannot be before the start date.' });
        }

        const applicant = await resolveLeaveApplicant(req.user);
        const id = String(req.body?.id || '').trim() || `${applicant.applicantRole === 'Teacher' ? 'TLEAVE' : 'LEAVE'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const existing = await sequelize.models.LeaveRequest.findByPk(id);
        if (existing && (existing.applicantRole !== applicant.applicantRole || String(existing.applicantId) !== applicant.applicantId)) {
            return res.status(403).json({ success: false, message: 'This leave request belongs to another portal user.' });
        }
        if (existing && String(existing.status || 'Pending') !== 'Pending') {
            return res.status(409).json({ success: false, message: 'Reviewed leave requests cannot be edited.' });
        }

        await sequelize.models.LeaveRequest.upsert({
            id,
            ...applicant,
            fromDate,
            toDate,
            reason,
            fileName: String(req.body?.fileName || '').trim(),
            fileType: String(req.body?.fileType || '').trim(),
            fileData: req.body?.fileData ? String(req.body.fileData) : '',
            status: 'Pending',
            reviewReason: null,
            reviewedAt: null,
            reviewEmailSentAt: null
        });
        const leaveRequest = await sequelize.models.LeaveRequest.findByPk(id);
        return res.json({ success: true, leaveRequest: formatLeaveRequest(leaveRequest) });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

app.post('/api/leave-requests/:id', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });
    if (!canReviewLeaveRequests(req.user)) {
        return res.status(403).json({ success: false, message: 'Admin or staff access required.' });
    }

    try {
        const status = String(req.body?.status || '').trim();
        const reviewReason = String(req.body?.reviewReason || '').trim();
        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Review status must be Approved or Rejected.' });
        }
        if (status === 'Rejected' && !reviewReason) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
        }

        const record = await sequelize.models.LeaveRequest.findByPk(req.params.id);
        if (!record) return res.status(404).json({ success: false, message: 'Leave request not found.' });

        await record.update({
            status,
            reviewReason: status === 'Rejected' ? reviewReason : '',
            reviewedAt: new Date().toISOString()
        });
        return res.json({ success: true, leaveRequest: formatLeaveRequest(record) });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/leave-requests/:id', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const record = await sequelize.models.LeaveRequest.findByPk(req.params.id);
        if (!record) return res.json({ success: true, deleted: false });

        const ownPendingRequest = ['Student', 'Teacher'].includes(req.user.role)
            && record.applicantRole === req.user.role
            && String(record.applicantId) === String(req.user.id)
            && String(record.status || 'Pending') === 'Pending';
        if (!canReviewLeaveRequests(req.user) && !ownPendingRequest) {
            return res.status(403).json({ success: false, message: 'Only pending portal leave requests can be deleted.' });
        }

        await record.destroy();
        return res.json({ success: true, deleted: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/students', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const data = Array.isArray(req.body) ? req.body : [req.body];
        const Student = sequelize.models.Student;
        const User = sequelize.models.User;

        const ids = data.map((item) => String(item?.id || '').trim()).filter(Boolean);
        const existingRows = ids.length
            ? await Student.findAll({ where: { id: ids }, attributes: ['id'] })
            : [];
        const existingIds = new Set(existingRows.map((row) => String(row.id)));

        const needsEdit = data.some((item) => {
            const id = String(item?.id || '').trim();
            return id && existingIds.has(id);
        });
        const needsAdd = data.some((item) => {
            const id = String(item?.id || '').trim();
            return !id || !existingIds.has(id);
        });

        if (needsAdd) {
            const ok = await enforceActionPermission(req, res, 'students', 'add');
            if (!ok) return;
        }
        if (needsEdit) {
            const ok = await enforceActionPermission(req, res, 'students', 'edit');
            if (!ok) return;
        }

        for (const item of data) {
            const normalizedUsername = String(item.username || '').trim();
            const rawPassword = item.plainPassword || item.password || '';
            item.email = normalizeOptionalEmail(item.email);
            item.username = normalizedUsername || null;
            await ensureUniqueStudentIdentity(Student, User, item);
            if (normalizedUsername && item.password && !isPasswordHash(item.password)) {
                item.password = await bcrypt.hash(item.password, 10);
            }
            if (!normalizedUsername) {
                item.password = null;
                item.plainPassword = null;
            } else {
                item.plainPassword = rawPassword || null;
            }

            await Student.upsert(item);
            await upsertAuthUser(User, {
                id: `student_${item.id}`,
                profileId: item.id,
                role: 'Student',
                username: item.username,
                email: normalizeOptionalEmail(item.email),
                password: item.password,
                fullName: item.fullName,
                campusName: item.campusName || null,
                plainPassword: item.plainPassword
            });
        }

        const allStudents = await Student.findAll();
        io.emit('students_update', allStudents);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/students/:id', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const ok = await enforceActionPermission(req, res, 'students', 'delete');
        if (!ok) return;

        const { id } = req.params;
        const Student = sequelize.models.Student;
        const User = sequelize.models.User;

        const deletedCount = await Student.destroy({ where: { id } });
        await User.destroy({
            where: {
                [Op.or]: [
                    { profileId: id, role: 'Student' },
                    { id: `student_${id}` }
                ]
            }
        });

        if (!deletedCount) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        const allStudents = await Student.findAll();
        io.emit('students_update', allStudents);
        res.json({ success: true, message: 'Student deleted successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/student-attendance', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const records = await sequelize.models.StudentAttendance.findAll({
            order: [['date', 'ASC']]
        });
        res.json({
            success: true,
            attendance: buildStudentAttendanceStore(records)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/student-attendance', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const StudentAttendance = sequelize.models.StudentAttendance;
        const payload = Array.isArray(req.body) ? req.body : [req.body];

        for (const item of payload) {
            const studentId = String(item?.studentId || '').trim();
            const date = String(item?.date || '').trim();
            const status = normalizeAttendanceStatus(item?.status);

            if (!studentId || !date) {
                return res.status(400).json({ success: false, message: 'studentId and date are required.' });
            }

            const recordId = `${studentId}_${date}`;

            if (status === 'Not Marked') {
                await StudentAttendance.destroy({ where: { id: recordId } });
                continue;
            }

            await StudentAttendance.upsert({
                id: recordId,
                studentId,
                date,
                status
            });
        }

        const records = await StudentAttendance.findAll({
            order: [['date', 'ASC']]
        });

        res.json({
            success: true,
            attendance: buildStudentAttendanceStore(records)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


app.get('/api/teacher-attendance', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const records = await sequelize.models.TeacherAttendance.findAll({
            order: [['date', 'ASC']]
        });
        res.json({
            success: true,
            attendance: buildTeacherAttendanceStore(records)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/teacher-attendance', async (req, res) => {
    if (!sequelize) return res.status(503).json({ success: false, message: 'Database offline' });

    try {
        const TeacherAttendance = sequelize.models.TeacherAttendance;
        const payload = Array.isArray(req.body) ? req.body : [req.body];

        for (const item of payload) {
            const teacherId = String(item?.teacherId || '').trim();
            const date = String(item?.date || '').trim();
            const status = normalizeAttendanceStatus(item?.status);

            if (!teacherId || !date) {
                return res.status(400).json({ success: false, message: 'teacherId and date are required.' });
            }

            const recordId = `${teacherId}_${date}`;

            if (status === 'Not Marked') {
                await TeacherAttendance.destroy({ where: { id: recordId } });
                continue;
            }

            await TeacherAttendance.upsert({
                id: recordId,
                teacherId,
                date,
                status
            });
        }

        const records = await TeacherAttendance.findAll({
            order: [['date', 'ASC']]
        });

        res.json({
            success: true,
            attendance: buildTeacherAttendanceStore(records)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/fees/challan-token', async (req, res) => {
    try {
        const {
            studentId,
            studentName,
            rollNo,
            classGrade,
            feeMonth,
            feeMonths,
            session,
            amount,
            fullAmount,
            challanNumber
        } = req.body || {};

        if (!studentId || !feeMonth || !challanNumber) {
            return res.status(400).json({ success: false, message: 'Student, fee month, and challan number are required.' });
        }

        const token = jwt.sign({
            studentId,
            studentName: studentName || '',
            rollNo: rollNo || '',
            classGrade: classGrade || '',
            feeMonth,
            feeMonths: Array.isArray(feeMonths) ? feeMonths : [],
            session: session || '',
            amount: Number(amount || 0),
            fullAmount: Number(fullAmount || amount || 0),
            challanNumber
        }, JWT_SECRET, { expiresIn: '120d' });

        const paymentUrl = `${getRequestBaseUrl(req)}/api/fees/pay/${encodeURIComponent(token)}`;
        const qrDataUrl = await QRCode.toDataURL(paymentUrl, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 220
        });

        return res.json({
            success: true,
            token,
            paymentUrl,
            qrDataUrl
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/fees/challan-tokens', async (req, res) => {
    try {
        const payload = req.body;
        const items = Array.isArray(payload) ? payload : payload?.items;

        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'items array is required.' });
        }

        if (items.length > 250) {
            return res.status(400).json({ success: false, message: 'Too many challans requested at once.' });
        }

        const baseUrl = getRequestBaseUrl(req);

        const mapWithConcurrency = async (list, limit, mapper) => {
            const results = new Array(list.length);
            let index = 0;

            const workerCount = Math.min(limit, list.length);
            const workers = Array.from({ length: workerCount }, async () => {
                while (true) {
                    const current = index++;
                    if (current >= list.length) return;
                    results[current] = await mapper(list[current], current);
                }
            });

            await Promise.all(workers);
            return results;
        };

        const tokens = await mapWithConcurrency(items, 6, async (item) => {
            const studentId = String(item?.studentId || '').trim();
            const feeMonth = String(item?.feeMonth || '').trim();
            const challanNumber = String(item?.challanNumber || '').trim();

            if (!studentId || !feeMonth || !challanNumber) {
                const err = new Error('studentId, feeMonth, and challanNumber are required.');
                err.statusCode = 400;
                throw err;
            }

            const token = jwt.sign({
                studentId,
                studentName: item?.studentName || '',
                rollNo: item?.rollNo || '',
                classGrade: item?.classGrade || '',
                feeMonth,
                feeMonths: Array.isArray(item?.feeMonths) ? item.feeMonths : [],
                session: item?.session || '',
                amount: Number(item?.amount || 0),
                fullAmount: Number(item?.fullAmount || item?.amount || 0),
                challanNumber
            }, JWT_SECRET, { expiresIn: '120d' });

            const paymentUrl = `${baseUrl}/api/fees/pay/${encodeURIComponent(token)}`;
            const qrDataUrl = await QRCode.toDataURL(paymentUrl, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 220
            });

            return { challanNumber, token, paymentUrl, qrDataUrl };
        });

        return res.json({ success: true, tokens });
    } catch (error) {
        const status = error?.statusCode || 500;
        return res.status(status).json({ success: false, message: error.message || 'Bulk QR code could not be generated.' });
    }
});

app.post('/api/fees/manual-payment', async (req, res) => {
    if (!sequelize) {
        return res.status(503).json({ success: false, message: 'Database offline' });
    }

    try {
        const {
            studentId,
            studentName,
            rollNo,
            classGrade,
            feeMonth,
            feeMonths,
            session,
            amount,
            fullAmount,
            paymentDate,
            challanNumber
        } = req.body || {};

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'studentId is required.' });
        }

        const Student = sequelize.models.Student;
        const FeePayment = sequelize.models.FeePayment;
        const FeeDueBalance = sequelize.models.FeeDueBalance;

        const student = await Student.findByPk(studentId);
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        const isZeroFeeStudent = student?.freeStudy === true ||
            student?.freeStudy === 'true' ||
            String(student?.zeroFeeReason || student?.freeStudyReason || '').trim() ||
            String(student?.feesStatus || '').trim().toLowerCase() === 'zero fee student';
        const paymentAmount = isZeroFeeStudent ? 0 : Number(amount || 0);
        const safeFullAmount = isZeroFeeStudent ? 0 : Number(fullAmount || amount || student.monthlyFee || 0);
        const remainingDue = Math.max(safeFullAmount - paymentAmount, 0);
        const resolvedStatus = remainingDue > 0 ? 'Partial' : 'Paid';

        const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

        const normalizeMonthList = (value) => Array.isArray(value)
            ? value.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const extractMonthList = (value) => {
            const lower = String(value || '').toLowerCase();
            return MONTHS.filter((month) => {
                const full = month.toLowerCase();
                const short = month.slice(0, 3).toLowerCase();
                return lower.includes(full) || lower.includes(short);
            });
        };

        let selectedMonths = normalizeMonthList(feeMonths);
        if (!selectedMonths.length) selectedMonths = extractMonthList(feeMonth);

        const feeMonthRecorded = selectedMonths.length ? selectedMonths.join(', ') : 'Dues';
        const safeChallanNumber = String(challanNumber || '').trim() || `MAN-${Date.now()}`;

        const existingPayment = await FeePayment.findByPk(safeChallanNumber);
        const alreadyRecorded = existingPayment && ['Paid', 'Partial'].includes(String(existingPayment.status || ''));
        const parsePaymentDate = (value) => {
            const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return null;
            const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const paidAt = existingPayment?.paidAt || parsePaymentDate(paymentDate) || new Date();
        const paymentDateLabel = paidAt.toLocaleDateString('en-GB');

        const paymentRow = {
            challanNumber: safeChallanNumber,
            studentId,
            studentName: studentName || student.fullName || '',
            rollNo: rollNo || student.rollNo || '',
            classGrade: classGrade || student.classGrade || '',
            session: session || '',
            feeMonth: feeMonthRecorded,
            amount: paymentAmount,
            status: resolvedStatus,
            paidAt,
            paymentDateLabel,
            paymentSource: 'Manual'
        };

        await FeePayment.upsert(paymentRow);

        if (!alreadyRecorded && FeeDueBalance) {
            const existingDue = await FeeDueBalance.findByPk(studentId);
            const currentBalance = existingDue ? Number(existingDue.balance || 0) : 0;
            const safeCurrent = Number.isFinite(currentBalance) ? currentBalance : 0;
            const reducedBalance = Math.max(safeCurrent - paymentAmount, 0);

            await FeeDueBalance.upsert({
                studentId,
                balance: reducedBalance,
                updatedAtLabel: new Date().toLocaleString('en-GB')
            });
        }

        const currentMonthName = MONTHS[new Date().getMonth()];
        const currentLower = currentMonthName.toLowerCase();
        const currentShortLower = currentMonthName.slice(0, 3).toLowerCase();
        const currentMonthPaid = selectedMonths.some((month) => {
            const lower = String(month || '').toLowerCase();
            return lower === currentLower || lower === currentShortLower;
        });

        if (currentMonthPaid && resolvedStatus === 'Paid') {
            await Student.update({
                feesStatus: 'Paid',
                paymentDate: paymentDateLabel
            }, {
                where: { id: studentId }
            });
        }

        const allStudents = await Student.findAll();
        io.emit('students_update', allStudents);
        io.emit('fee_payment_update', { payment: paymentRow });

        return res.json({ success: true, payment: paymentRow, alreadyRecorded });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Manual payment failed.' });
    }
});

app.get('/api/fees/payments', async (req, res) => {
    if (!sequelize) {
        return res.status(503).json({ success: false, message: 'Database offline' });
    }

    try {
        const FeePayment = sequelize.models.FeePayment;
        const payments = await FeePayment.findAll({
            where: { status: { [Op.in]: ['Paid', 'Partial'] } },
            order: [['paidAt', 'DESC']]
        });

        return res.json({
            success: true,
            payments
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || 'Fee payments could not be loaded.'
        });
    }
});

app.post('/api/fees/mark-unpaid', async (req, res) => {
    if (!sequelize) {
        return res.status(503).json({ success: false, message: 'Database offline' });
    }

    try {
        const { studentId, feeMonth, challanNumbers } = req.body || {};
        const sid = String(studentId || '').trim();
        const month = String(feeMonth || '').trim();

        if (!sid || !month) {
            return res.status(400).json({ success: false, message: 'studentId and feeMonth are required.' });
        }

        const Student = sequelize.models.Student;
        const FeePayment = sequelize.models.FeePayment;
        const FeeDueBalance = sequelize.models.FeeDueBalance;
        const student = await Student.findByPk(sid);

        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }

        const cleanChallans = Array.isArray(challanNumbers)
            ? challanNumbers.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        const where = {
            studentId: sid,
            status: { [Op.in]: ['Paid', 'Partial'] }
        };

        if (cleanChallans.length) {
            where.challanNumber = { [Op.in]: cleanChallans };
        } else {
            where.feeMonth = { [Op.like]: `%${month}%` };
        }

        const payments = await FeePayment.findAll({ where });
        if (!payments.length) {
            return res.status(404).json({ success: false, message: 'No paid payment record found for this month.' });
        }

        const removedAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        await FeePayment.update({
            status: 'Voided',
            paymentSource: 'Correction'
        }, { where });

        if (FeeDueBalance && removedAmount > 0) {
            const existingDue = await FeeDueBalance.findByPk(sid);
            const currentBalance = existingDue ? Number(existingDue.balance || 0) : 0;
            const safeCurrent = Number.isFinite(currentBalance) ? currentBalance : 0;

            await FeeDueBalance.upsert({
                studentId: sid,
                balance: safeCurrent + removedAmount,
                updatedAtLabel: new Date().toLocaleString('en-GB')
            });
        }

        const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        if (month.toLowerCase() === MONTHS[new Date().getMonth()].toLowerCase()) {
            await Student.update({ feesStatus: 'Pending', paymentDate: null }, { where: { id: sid } });
        }

        const allStudents = await Student.findAll();
        io.emit('students_update', allStudents);
        io.emit('fee_payment_update', { studentId: sid, feeMonth: month, status: 'Voided' });

        return res.json({
            success: true,
            message: 'Fee marked as unpaid.',
            removedCount: payments.length,
            removedAmount
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Could not mark unpaid.' });
    }
});

app.get('/api/fees/due-balances', async (req, res) => {
    if (!sequelize) {
        return res.status(503).json({ success: false, message: 'Database offline' });
    }

    try {
        const FeeDueBalance = sequelize.models.FeeDueBalance;
        if (!FeeDueBalance) {
            return res.json({ success: true, balances: {} });
        }

        const rows = await FeeDueBalance.findAll();
        const balances = rows.reduce((acc, row) => {
            const studentId = String(row.studentId || '').trim();
            if (!studentId) return acc;
            const balance = Number(row.balance || 0);
            acc[studentId] = Number.isFinite(balance) ? balance : 0;
            return acc;
        }, {});

        return res.json({ success: true, balances });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || 'Due balances could not be loaded.'
        });
    }
});

app.get('/api/fees/pay/:token', async (req, res) => {
    if (!sequelize) {
        return res.status(503).send(renderFeePaymentPage({
            title: 'Server Offline',
            message: 'The database server is offline, so this fee payment could not be recorded.',
            success: false
        }));
    }

    try {
        const payload = jwt.verify(req.params.token, JWT_SECRET);
        const Student = sequelize.models.Student;
        const FeePayment = sequelize.models.FeePayment;
        const FeeDueBalance = sequelize.models.FeeDueBalance;

        const student = await Student.findByPk(payload.studentId);
        if (!student) {
            return res.status(404).send(renderFeePaymentPage({
                title: 'Student Not Found',
                message: 'This challan is valid, but the linked student record was not found.',
                success: false
            }));
        }

        const existingPayment = await FeePayment.findByPk(payload.challanNumber);
        const alreadyRecorded = existingPayment && ['Paid', 'Partial'].includes(String(existingPayment.status || ''));
        const paidAt = existingPayment?.paidAt || new Date();
        const paymentDateLabel = paidAt.toLocaleDateString('en-GB');

        const isZeroFeeStudent = student?.freeStudy === true ||
            student?.freeStudy === 'true' ||
            String(student?.zeroFeeReason || student?.freeStudyReason || '').trim() ||
            String(student?.feesStatus || '').trim().toLowerCase() === 'zero fee student';
        const paymentAmount = isZeroFeeStudent ? 0 : Number(payload.amount || student.monthlyFee || 0);
        const fullAmount = isZeroFeeStudent ? 0 : Number(payload.fullAmount || payload.amount || student.monthlyFee || 0);
        const remainingDue = Math.max(fullAmount - paymentAmount, 0);
        const resolvedStatus = remainingDue > 0 ? 'Partial' : 'Paid';

        const normalizeMonthList = (value) => Array.isArray(value)
            ? value.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        const extractMonthList = (value) => {
            const lower = String(value || '').toLowerCase();
            return MONTHS.filter((month) => {
                const full = month.toLowerCase();
                const short = month.slice(0, 3).toLowerCase();
                return lower.includes(full) || lower.includes(short);
            });
        };

        let selectedMonths = normalizeMonthList(payload.feeMonths);
        if (!selectedMonths.length) selectedMonths = extractMonthList(payload.feeMonth);
        const monthsPaid = selectedMonths;
        const feeMonthRecorded = monthsPaid.length ? monthsPaid.join(', ') : 'Dues';

        const paymentRow = {
            challanNumber: payload.challanNumber,
            studentId: payload.studentId,
            studentName: payload.studentName || student.fullName || '',
            rollNo: payload.rollNo || student.rollNo || '',
            classGrade: payload.classGrade || student.classGrade || '',
            session: payload.session || '',
            feeMonth: feeMonthRecorded,
            amount: paymentAmount,
            status: resolvedStatus,
            paidAt,
            paymentDateLabel,
            paymentSource: 'QR Scan'
        };

        await FeePayment.upsert(paymentRow);

        if (!alreadyRecorded && FeeDueBalance) {
            const existingDue = await FeeDueBalance.findByPk(payload.studentId);
            const currentBalance = existingDue ? Number(existingDue.balance || 0) : 0;
            const safeCurrent = Number.isFinite(currentBalance) ? currentBalance : 0;
            const reducedBalance = Math.max(safeCurrent - paymentAmount, 0);

            await FeeDueBalance.upsert({
                studentId: payload.studentId,
                balance: reducedBalance,
                updatedAtLabel: new Date().toLocaleString('en-GB')
            });
        }

        const currentMonthName = MONTHS[new Date().getMonth()];
        const feeMonthRaw = String(payload.feeMonth || '');
        const feeMonthLower = feeMonthRaw.toLowerCase();
        const currentLower = currentMonthName.toLowerCase();
        const currentShortLower = currentMonthName.slice(0, 3).toLowerCase();
        const shouldUpdateCurrentMonthStatus = feeMonthLower.includes(currentLower) || feeMonthLower.includes(currentShortLower);

        const currentMonthPaid = monthsPaid.some((month) => {
            const lower = String(month || '').toLowerCase();
            return lower === currentLower || lower === currentShortLower;
        });
        if (resolvedStatus === 'Paid' && (shouldUpdateCurrentMonthStatus || currentMonthPaid) && monthsPaid.length) {
            await Student.update({
                feesStatus: 'Paid',
                paymentDate: paymentDateLabel
            }, {
                where: { id: payload.studentId }
            });
        }

        const allStudents = await Student.findAll();
        io.emit('students_update', allStudents);
        io.emit('fee_payment_update', { payment: paymentRow });

        return res.send(renderFeePaymentPage({
            title: alreadyRecorded ? 'Already Recorded' : (paymentRow.status === 'Paid' ? 'Fee Marked Paid' : 'Payment Recorded'),
            message: alreadyRecorded
                ? 'This challan was already scanned earlier. The payment remains recorded in the system.'
                : (paymentRow.status === 'Paid'
                    ? 'The fee has been marked as paid successfully in the system.'
                    : 'Payment has been recorded. Remaining amount is still due.'),
            details: [
                { label: 'Student', value: payload.studentName || student.fullName || '-' },
                { label: 'Roll No', value: payload.rollNo || student.rollNo || '-' },
                { label: 'Class', value: payload.classGrade || student.classGrade || '-' },
                { label: 'Fee Month', value: payload.feeMonth || '-' },
                { label: 'Session', value: payload.session || '-' },
                { label: 'Amount', value: `PKR ${Number(paymentAmount || 0).toLocaleString('en-PK')}` },
                ...(remainingDue > 0 ? [{ label: 'Remaining Due', value: `PKR ${Number(remainingDue || 0).toLocaleString('en-PK')}` }] : []),
                { label: 'Challan No.', value: payload.challanNumber || '-' },
                { label: 'Paid On', value: paymentDateLabel }
            ],
            success: true
        }));
    } catch (error) {
        return res.status(400).send(renderFeePaymentPage({
            title: 'Invalid QR Code',
            message: 'This QR code is invalid or has expired, so the fee could not be recorded.',
            success: false
        }));
    }
});

app.get('/api/teachers', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const teachers = await sequelize.models.Teacher.findAll({
            attributes: [
                'id', 'employeeCode', 'fullName', 'profileImage', 'fatherName', 'dob', 'cnic', 'phone',
                'email', 'address', 'qualification', 'campusName', 'gender', 'designation', 'subject', 'salary',
                'idCardFront', 'idCardBack', 'cvFile', 'bankName', 'bankAccountTitle',
                'bankAccountNumber', 'bankBranch', 'schedule', 'username', 'password', 'plainPassword', 'role', 'groupKey'
            ]
        });
        res.json(teachers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/staff', async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const staff = await sequelize.models.Staff.findAll();
        res.json(staff);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/teachers', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const data = Array.isArray(req.body) ? req.body : [req.body];
        const Teacher = sequelize.models.Teacher;
        const User = sequelize.models.User;

        const ids = data.map((item) => String(item?.id || '').trim()).filter(Boolean);
        const existingRows = ids.length
            ? await Teacher.findAll({ where: { id: ids }, attributes: ['id'] })
            : [];
        const existingIds = new Set(existingRows.map((row) => String(row.id)));

        const needsEdit = data.some((item) => {
            const id = String(item?.id || '').trim();
            return id && existingIds.has(id);
        });
        const needsAdd = data.some((item) => {
            const id = String(item?.id || '').trim();
            return !id || !existingIds.has(id);
        });

        if (needsAdd) {
            const ok = await enforceActionPermission(req, res, 'teachers', 'add');
            if (!ok) return;
        }
        if (needsEdit) {
            const ok = await enforceActionPermission(req, res, 'teachers', 'edit');
            if (!ok) return;
        }

        for (const item of data) {
            const rawPassword = item.plainPassword || item.password || '';
            item.email = normalizeOptionalEmail(item.email);
            await ensureUniqueTeacherIdentity(Teacher, User, item);
            if (item.password && !isPasswordHash(item.password)) {
                item.password = await bcrypt.hash(item.password, 10);
            }
            item.plainPassword = rawPassword;
            if (Array.isArray(item.schedule)) {
                item.schedule = JSON.stringify(item.schedule);
            }

            await Teacher.upsert(item);
            await upsertAuthUser(User, {
                id: `teacher_${item.id}`,
                profileId: item.id,
                role: 'Teacher',
                username: item.username,
                email: normalizeOptionalEmail(item.email),
                password: item.password,
                fullName: item.fullName,
                campusName: item.campusName,
                plainPassword: item.plainPassword,
                groupKey: item.groupKey || 'teacher'
            });
        }

        const allTeachers = await Teacher.findAll({
            attributes: [
                'id', 'employeeCode', 'fullName', 'profileImage', 'fatherName', 'dob', 'cnic', 'phone',
                'email', 'address', 'qualification', 'campusName', 'gender', 'designation', 'subject', 'salary',
                'idCardFront', 'idCardBack', 'cvFile', 'bankName', 'bankAccountTitle',
                'bankAccountNumber', 'bankBranch', 'schedule', 'username', 'password', 'plainPassword', 'role', 'groupKey'
            ]
        });
        io.emit('teachers_update', allTeachers);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/teachers/:id', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const ok = await enforceActionPermission(req, res, 'teachers', 'delete');
        if (!ok) return;

        const { id } = req.params;
        const Teacher = sequelize.models.Teacher;
        const User = sequelize.models.User;

        const deletedCount = await Teacher.destroy({ where: { id } });
        await User.destroy({
            where: {
                [Op.or]: [
                    { profileId: id, role: 'Teacher' },
                    { id: `teacher_${id}` }
                ]
            }
        });

        if (!deletedCount) {
            return res.status(404).json({ success: false, message: 'Teacher not found.' });
        }

        const allTeachers = await Teacher.findAll({
            attributes: [
                'id', 'employeeCode', 'fullName', 'profileImage', 'fatherName', 'dob', 'cnic', 'phone',
                'email', 'address', 'qualification', 'campusName', 'gender', 'designation', 'subject', 'salary',
                'idCardFront', 'idCardBack', 'cvFile', 'bankName', 'bankAccountTitle',
                'bankAccountNumber', 'bankBranch', 'schedule', 'username', 'password', 'plainPassword', 'role', 'groupKey'
            ]
        });
        io.emit('teachers_update', allTeachers);
        res.json({ success: true, message: 'Teacher deleted successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/staff', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const data = Array.isArray(req.body) ? req.body : [req.body];
        const Staff = sequelize.models.Staff;
        const User = sequelize.models.User;

        const ids = data.map((item) => String(item?.id || '').trim()).filter(Boolean);
        const existingRows = ids.length
            ? await Staff.findAll({ where: { id: ids }, attributes: ['id'] })
            : [];
        const existingIds = new Set(existingRows.map((row) => String(row.id)));

        const needsEdit = data.some((item) => {
            const id = String(item?.id || '').trim();
            return id && existingIds.has(id);
        });
        const needsAdd = data.some((item) => {
            const id = String(item?.id || '').trim();
            return !id || !existingIds.has(id);
        });

        if (needsAdd) {
            const ok = await enforceActionPermission(req, res, 'staff', 'add');
            if (!ok) return;
        }
        if (needsEdit) {
            const ok = await enforceActionPermission(req, res, 'staff', 'edit');
            if (!ok) return;
        }

        for (const item of data) {
            const rawPassword = item.plainPassword || item.password || '';
            item.email = normalizeOptionalEmail(item.email);

            if (item.password && !isPasswordHash(item.password)) {
                item.password = await bcrypt.hash(item.password, 10);
            }

            item.plainPassword = rawPassword;

            await Staff.upsert(item);
            await upsertAuthUser(User, {
                id: `staff_${item.id}`,
                profileId: item.id,
                role: 'Staff',
                username: item.username,
                email: normalizeOptionalEmail(item.email),
                password: item.password,
                fullName: item.fullName,
                plainPassword: item.plainPassword,
                groupKey: item.groupKey || 'staff'
            });
        }

        const allStaff = await Staff.findAll();
        io.emit('staff_update', allStaff);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/staff/:id', authenticateToken, async (req, res) => {
    if (!sequelize) return res.status(503).json({ error: 'Database offline' });

    try {
        const ok = await enforceActionPermission(req, res, 'staff', 'delete');
        if (!ok) return;

        const { id } = req.params;
        const Staff = sequelize.models.Staff;
        const User = sequelize.models.User;

        const deletedCount = await Staff.destroy({ where: { id } });
        await User.destroy({
            where: {
                [Op.or]: [
                    { profileId: id, role: 'Staff' },
                    { id: `staff_${id}` }
                ]
            }
        });

        if (!deletedCount) {
            return res.status(404).json({ success: false, message: 'Staff not found.' });
        }

        const allStaff = await Staff.findAll();
        io.emit('staff_update', allStaff);
        res.json({ success: true, message: 'Staff deleted successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/email/config', authenticateToken, (req, res) => {
    const config = getSmtpConfig();
    res.json({
        success: true,
        configured: Boolean(config.host && config.port && config.user && config.pass && config.fromEmail),
        host: config.host || '',
        port: config.port || 587,
        secure: config.secure,
        user: config.user ? config.user.replace(/^(.{2}).*(@.*)?$/, '$1***$2') : '',
        fromEmail: config.fromEmail || '',
        fromName: config.fromName || ''
    });
});

app.post('/api/email/send', authenticateToken, async (req, res) => {
    try {
        const result = await sendSmtpEmail(req.body || {});
        res.json({
            success: true,
            message: 'Email sent successfully.',
            ...result
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Email could not be sent.'
        });
    }
});

function trimAiText(value = '', maxLength = 180) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function pickSafePersonFields(item = {}, type = 'student') {
    if (type === 'student') {
        return {
            id: item.studentCode || item.id || '',
            name: item.fullName || '',
            class: item.classGrade || '',
            campus: item.campusName || '',
            rollNo: item.rollNo || '',
            feeStatus: item.feesStatus || '',
            monthlyFee: item.monthlyFee || ''
        };
    }
    if (type === 'teacher') {
        return {
            id: item.employeeCode || item.id || '',
            name: item.fullName || '',
            campus: item.campusName || '',
            subject: item.subject || '',
            designation: item.designation || '',
            salary: item.salary || ''
        };
    }
    return {
        id: item.employeeCode || item.id || '',
        name: item.fullName || '',
        campus: item.campusName || '',
        designation: item.designation || '',
        salary: item.salary || ''
    };
}

async function buildAiSchoolContext(user = {}) {
    if (!sequelize || !isInitialized) {
        return {
            online: false,
            message: 'Database is offline. Only general portal guidance is available.'
        };
    }

    const { Student, Teacher, Staff, ClassFee, FeePayment, FeeDueBalance } = sequelize.models;
    const campusFilter = String(user?.campusName || '').trim();
    const role = String(user?.role || '').trim();
    const whereCampus = campusFilter && !['Admin', 'Principal'].includes(role) ? { campusName: campusFilter } : {};

    const [students, teachers, staff, classFees, payments, dueBalances] = await Promise.all([
        Student ? Student.findAll({ where: whereCampus, order: [['fullName', 'ASC']], limit: 80 }) : [],
        Teacher ? Teacher.findAll({ where: whereCampus, order: [['fullName', 'ASC']], limit: 80 }) : [],
        Staff ? Staff.findAll({ where: whereCampus, order: [['fullName', 'ASC']], limit: 80 }) : [],
        ClassFee ? ClassFee.findAll({ order: [['className', 'ASC']] }) : [],
        FeePayment ? FeePayment.findAll({ order: [['paidAt', 'DESC']], limit: 20 }) : [],
        FeeDueBalance ? FeeDueBalance.findAll({ limit: 80 }) : []
    ]);

    const safeStudents = students.map((item) => pickSafePersonFields(item.get ? item.get({ plain: true }) : item, 'student'));
    const safeTeachers = teachers.map((item) => pickSafePersonFields(item.get ? item.get({ plain: true }) : item, 'teacher'));
    const safeStaff = staff.map((item) => pickSafePersonFields(item.get ? item.get({ plain: true }) : item, 'staff'));
    const campusNames = Array.from(new Set([
        ...safeStudents.map((item) => item.campus),
        ...safeTeachers.map((item) => item.campus),
        ...safeStaff.map((item) => item.campus)
    ].filter(Boolean)));
    const classNames = Array.from(new Set(safeStudents.map((item) => item.class).filter(Boolean)));

    return {
        online: true,
        user: {
            role,
            id: user?.id || '',
            campusName: campusFilter || 'All campuses'
        },
        summary: {
            students: safeStudents.length,
            teachers: safeTeachers.length,
            staff: safeStaff.length,
            campuses: campusNames,
            classes: classNames
        },
        students: safeStudents.slice(0, 50),
        teachers: safeTeachers.slice(0, 50),
        staff: safeStaff.slice(0, 50),
        classFees: classFees.map((item) => {
            const row = item.get ? item.get({ plain: true }) : item;
            return { className: row.className || '', monthlyFee: row.monthlyFee || 0 };
        }).slice(0, 40),
        recentPayments: payments.map((item) => {
            const row = item.get ? item.get({ plain: true }) : item;
            return {
                studentName: row.studentName || '',
                rollNo: row.rollNo || '',
                classGrade: row.classGrade || '',
                campusName: row.campusName || '',
                feeMonth: row.feeMonth || '',
                amount: row.amount || 0,
                status: row.status || '',
                paidAt: row.paidAt || ''
            };
        }),
        dueBalances: dueBalances.map((item) => {
            const row = item.get ? item.get({ plain: true }) : item;
            return {
                studentId: row.studentId || '',
                studentName: row.studentName || '',
                rollNo: row.rollNo || '',
                pendingBalance: row.pendingBalance || 0
            };
        }).slice(0, 50)
    };
}

function buildLocalAiAnswer(question = '', context = {}) {
    const q = String(question || '').toLowerCase();
    const summary = context.summary || {};
    if (!context.online) return context.message || 'Database offline hai, is waqt detailed school data available nahi.';
    if (q.includes('student')) {
        return `System me ${summary.students || 0} students hain. Classes: ${(summary.classes || []).join(', ') || '-'}. Campus: ${(summary.campuses || []).join(', ') || '-'}.`;
    }
    if (q.includes('teacher')) {
        return `System me ${summary.teachers || 0} teachers hain. Teacher list ke liye Teachers module open karein.`;
    }
    if (q.includes('staff')) {
        return `System me ${summary.staff || 0} staff members hain. Staff details Staff module me available hain.`;
    }
    if (q.includes('fee') || q.includes('fees') || q.includes('revenue')) {
        const totalRecent = (context.recentPayments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
        return `Recent saved payments total PKR ${totalRecent.toLocaleString()} hai. Detailed branch/class revenue ke liye Finance/Revenue page use karein.`;
    }
    return `Main school system context ke hisab se help kar sakta hun. Current snapshot: ${summary.students || 0} students, ${summary.teachers || 0} teachers, ${summary.staff || 0} staff, campuses: ${(summary.campuses || []).join(', ') || '-'}.`;
}

async function callOpenAiForSchoolAnswer(message, context) {
    const prompt = [
        'You are PESS JAND portal assistant.',
        'Answer in the same language style as the user. Most users write Roman Urdu.',
        'Use only the provided school system context. If exact data is not present, say that it is not available in the current system snapshot.',
        'Do not expose passwords, secrets, API keys, or hidden implementation details.',
        'Keep answers concise and practical.',
        '',
        `School context JSON:\n${JSON.stringify(context).slice(0, 18000)}`,
        '',
        `User question: ${trimAiText(message, 1000)}`
    ].join('\n');

    const response = await axios.post('https://api.openai.com/v1/responses', {
        model: OPENAI_MODEL,
        input: prompt,
        max_output_tokens: 450
    }, {
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 20000
    });

    const data = response.data || {};
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    const outputText = (data.output || [])
        .flatMap((item) => item.content || [])
        .map((part) => part.text || '')
        .join('')
        .trim();
    return outputText || '';
}

app.post('/api/ai-chat', authenticateToken, async (req, res) => {
    try {
        const message = trimAiText(req.body?.message || '', 1200);
        if (!message) {
            return res.status(400).json({ success: false, message: 'Message is required.' });
        }

        const context = await buildAiSchoolContext(req.user || {});
        let answer = '';
        let provider = 'local';

        if (OPENAI_API_KEY) {
            try {
                answer = await callOpenAiForSchoolAnswer(message, context);
                provider = 'openai';
            } catch (error) {
                console.warn('AI provider failed:', error?.response?.data || error.message);
            }
        }

        if (!answer) answer = buildLocalAiAnswer(message, context);

        res.json({
            success: true,
            provider,
            answer
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'AI chat could not respond.'
        });
    }
});

app.all('/api', (req, res) => {
    res.status(404).json({
        success: false,
        message: `API route not found: ${req.method} ${req.originalUrl}`
    });
});

app.all('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: `API route not found: ${req.method} ${req.originalUrl}`
    });
});

app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    if (req.originalUrl && req.originalUrl.startsWith('/api')) {
        return res.status(err.status || 500).json({
            success: false,
            message: err.message || 'Internal server error.'
        });
    }

    return next(err);
});

function defineStudentModel(db) {
    return db.define('Student', {
        id: { type: DataTypes.STRING, primaryKey: true },
        studentCode: DataTypes.STRING,
        fullName: DataTypes.STRING,
        profileImage: DataTypes.TEXT('long'),
        fatherName: DataTypes.STRING,
        dob: DataTypes.STRING,
        admissionDate: DataTypes.STRING,
        classGrade: DataTypes.STRING,
        campusName: DataTypes.STRING,
        gender: DataTypes.STRING,
        parentPhone: DataTypes.STRING,
        nonDigital: DataTypes.BOOLEAN,
        email: { type: DataTypes.STRING, unique: true, allowNull: true },
        rollNo: DataTypes.STRING,
        formB: DataTypes.STRING,
        monthlyFee: DataTypes.STRING,
        feeFrequency: DataTypes.STRING,
        feesStatus: { type: DataTypes.STRING, defaultValue: 'Pending' },
        paymentDate: DataTypes.STRING,
        username: { type: DataTypes.STRING, unique: true },
        password: DataTypes.STRING,
        plainPassword: DataTypes.STRING,
        role: { type: DataTypes.STRING, defaultValue: 'Student' }
    });
}

function defineTeacherModel(db) {
    return db.define('Teacher', {
        id: { type: DataTypes.STRING, primaryKey: true },
        employeeCode: DataTypes.STRING,
        fullName: DataTypes.STRING,
        profileImage: DataTypes.TEXT('long'),
        fatherName: DataTypes.STRING,
        dob: DataTypes.STRING,
        cnic: DataTypes.STRING,
        phone: DataTypes.STRING,
        email: { type: DataTypes.STRING, unique: true, allowNull: true },
        address: DataTypes.TEXT,
        qualification: DataTypes.STRING,
        campusName: DataTypes.STRING,
        gender: DataTypes.STRING,
        designation: DataTypes.STRING,
        subject: DataTypes.STRING,
        salary: DataTypes.STRING,
        idCardFront: DataTypes.TEXT('long'),
        idCardBack: DataTypes.TEXT('long'),
        cvFile: DataTypes.TEXT('long'),
        bankName: DataTypes.STRING,
        bankAccountTitle: DataTypes.STRING,
        bankAccountNumber: DataTypes.STRING,
        bankBranch: DataTypes.STRING,
        schedule: DataTypes.TEXT('long'),
        username: { type: DataTypes.STRING, unique: true },
        password: DataTypes.STRING,
        plainPassword: DataTypes.STRING,
        groupKey: DataTypes.STRING,
        role: { type: DataTypes.STRING, defaultValue: 'Teacher' }
    });
}

function defineUserModel(db) {
    return db.define('User', {
        id: { type: DataTypes.STRING, primaryKey: true },
        profileId: { type: DataTypes.STRING, allowNull: false },
        fullName: DataTypes.STRING,
        campusName: DataTypes.STRING,
        email: { type: DataTypes.STRING, unique: true, allowNull: true },
        username: { type: DataTypes.STRING, unique: true, allowNull: false },
        password: { type: DataTypes.STRING, allowNull: false },
        plainPassword: DataTypes.STRING,
        groupKey: DataTypes.STRING,
        role: { type: DataTypes.STRING, allowNull: false },
        isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
    });
}

function defineStaffModel(db) {
    return db.define('Staff', {
        id: { type: DataTypes.STRING, primaryKey: true },
        employeeCode: DataTypes.STRING,
        fullName: DataTypes.STRING,
        fatherName: DataTypes.STRING,
        dob: DataTypes.STRING,
        designation: DataTypes.STRING,
        cnic: DataTypes.STRING,
        phone: DataTypes.STRING,
        email: { type: DataTypes.STRING, unique: true, allowNull: true },
        address: DataTypes.TEXT,
        gender: DataTypes.STRING,
        salary: DataTypes.STRING,
        idCardFront: DataTypes.TEXT('long'),
        idCardBack: DataTypes.TEXT('long'),
        bankName: DataTypes.STRING,
        bankAccountTitle: DataTypes.STRING,
        bankAccountNumber: DataTypes.STRING,
        bankBranch: DataTypes.STRING,
        username: { type: DataTypes.STRING, unique: true, allowNull: true },
        password: DataTypes.STRING,
        plainPassword: DataTypes.STRING,
        groupKey: DataTypes.STRING,
        role: { type: DataTypes.STRING, defaultValue: 'Staff' }
    });
}

function defineFeePaymentModel(db) {
    return db.define('FeePayment', {
        challanNumber: { type: DataTypes.STRING, primaryKey: true },
        studentId: { type: DataTypes.STRING, allowNull: false },
        studentName: DataTypes.STRING,
        rollNo: DataTypes.STRING,
        classGrade: DataTypes.STRING,
        session: DataTypes.STRING,
        feeMonth: DataTypes.STRING,
        amount: DataTypes.DECIMAL(10, 2),
        status: { type: DataTypes.STRING, defaultValue: 'Pending' },
        paidAt: { type: DataTypes.DATE, allowNull: true },
        paymentDateLabel: DataTypes.STRING,
        paymentSource: DataTypes.STRING
    });
}

function defineFeeDueBalanceModel(db) {
    return db.define('FeeDueBalance', {
        studentId: { type: DataTypes.STRING, primaryKey: true },
        balance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
        updatedAtLabel: DataTypes.STRING
    });
}

function defineClassFeeModel(db) {
    return db.define('ClassFee', {
        id: { type: DataTypes.STRING, primaryKey: true },
        className: { type: DataTypes.STRING, allowNull: false },
        monthlyFee: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
        feeFrequency: { type: DataTypes.STRING, defaultValue: 'Monthly' },
        updatedAtLabel: DataTypes.STRING
    });
}

function defineStudentAttendanceModel(db) {
    return db.define('StudentAttendance', {
        id: { type: DataTypes.STRING, primaryKey: true },
        studentId: { type: DataTypes.STRING, allowNull: false },
        date: { type: DataTypes.STRING, allowNull: false },
        status: { type: DataTypes.STRING, allowNull: false }
    });
}

function defineTeacherAttendanceModel(db) {
    return db.define('TeacherAttendance', {
        id: { type: DataTypes.STRING, primaryKey: true },
        teacherId: { type: DataTypes.STRING, allowNull: false },
        date: { type: DataTypes.STRING, allowNull: false },
        status: { type: DataTypes.STRING, allowNull: false }
    });
}

function defineLeaveRequestModel(db) {
    return db.define('LeaveRequest', {
        id: { type: DataTypes.STRING, primaryKey: true },
        applicantRole: { type: DataTypes.STRING, allowNull: false },
        applicantId: { type: DataTypes.STRING, allowNull: false },
        applicantName: DataTypes.STRING,
        email: DataTypes.STRING,
        studentCode: DataTypes.STRING,
        rollNo: DataTypes.STRING,
        classGrade: DataTypes.STRING,
        subject: DataTypes.STRING,
        campusName: DataTypes.STRING,
        fromDate: { type: DataTypes.STRING, allowNull: false },
        toDate: { type: DataTypes.STRING, allowNull: false },
        reason: { type: DataTypes.TEXT, allowNull: false },
        fileName: DataTypes.STRING,
        fileType: DataTypes.STRING,
        fileData: DataTypes.TEXT('long'),
        status: { type: DataTypes.STRING, defaultValue: 'Pending' },
        reviewReason: DataTypes.TEXT,
        reviewedAt: DataTypes.STRING,
        reviewEmailSentAt: DataTypes.STRING
    });
}

function defineSpecialNoticeModel(db) {
    return db.define('SpecialNotice', {
        id: { type: DataTypes.STRING, primaryKey: true },
        title: { type: DataTypes.STRING, allowNull: false },
        message: { type: DataTypes.TEXT('long'), allowNull: false },
        targetPortals: { type: DataTypes.TEXT('long'), allowNull: false },
        status: { type: DataTypes.STRING, defaultValue: 'draft' },
        executedAt: { type: DataTypes.DATE, allowNull: true },
        createdAtLabel: DataTypes.STRING
    });
}

function defineBannerModel(db) {
    return db.define('Banner', {
        id: { type: DataTypes.STRING, primaryKey: true },
        title: { type: DataTypes.STRING, allowNull: false },
        subtitle: { type: DataTypes.STRING, allowNull: true },
        imageUrl: { type: DataTypes.TEXT('long'), allowNull: false },
        linkUrl: { type: DataTypes.STRING, allowNull: true },
        placement: { type: DataTypes.STRING, defaultValue: 'banner' },
        displayOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
        isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
    });
}

function defineMessageModel(db) {
    return db.define('Message', {
        id: { type: DataTypes.STRING, primaryKey: true },
        subject: { type: DataTypes.STRING, allowNull: false },
        body: { type: DataTypes.TEXT('long'), allowNull: false },
        targetRole: { type: DataTypes.STRING, allowNull: false },
        targetScope: { type: DataTypes.STRING, allowNull: false },
        campusName: { type: DataTypes.STRING, allowNull: true },
        classGrade: { type: DataTypes.STRING, allowNull: true },
        recipientId: { type: DataTypes.STRING, allowNull: true },
        recipientName: { type: DataTypes.STRING, allowNull: true },
        senderName: { type: DataTypes.STRING, allowNull: true },
        thread: { type: DataTypes.TEXT('long'), allowNull: true },
        chatStatus: { type: DataTypes.STRING, defaultValue: 'open' },
        createdAtLabel: DataTypes.STRING
    });
}

function normalizeAttendanceStatus(status) {
    if (status === 'P') return 'Present';
    if (status === 'A') return 'Absent';
    if (status === 'Present' || status === 'Late' || status === 'Absent') return status;
    return 'Not Marked';
}

function buildStudentAttendanceStore(records) {
    return records.reduce((store, record) => {
        const studentId = String(record.studentId || '').trim();
        const date = String(record.date || '').trim();
        const status = normalizeAttendanceStatus(record.status);

        if (!studentId || !date || status === 'Not Marked') {
            return store;
        }

        if (!Array.isArray(store[studentId])) {
            store[studentId] = [];
        }

        store[studentId].push({ date, status });
        store[studentId].sort((a, b) => a.date.localeCompare(b.date));
        return store;
    }, {});
}

function buildTeacherAttendanceStore(records) {
    return records.reduce((store, record) => {
        const teacherId = String(record.teacherId || '').trim();
        const date = String(record.date || '').trim();
        const status = normalizeAttendanceStatus(record.status);

        if (!teacherId || !date || status === 'Not Marked') {
            return store;
        }

        const monthKey = date.slice(0, 7);
        const dayIndex = Number(date.slice(8, 10)) - 1;
        const recordKey = `${teacherId}_${monthKey}`;

        if (!Array.isArray(store[recordKey])) {
            const daysInMonth = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate();
            store[recordKey] = Array(daysInMonth).fill('Not Marked');
        }

        if (dayIndex >= 0 && dayIndex < store[recordKey].length) {
            store[recordKey][dayIndex] = status;
        }

        return store;
    }, {});
}

function getRequestBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function renderFeePaymentPage({ title, message, details = [], success = true }) {
    const detailRows = details.map(({ label, value }) => `
        <div class="detail-row">
            <span>${label}</span>
            <strong>${value}</strong>
        </div>
    `).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                body {
                    margin: 0;
                    font-family: Arial, sans-serif;
                    background: #f4f7fb;
                    color: #1f2937;
                    display: grid;
                    place-items: center;
                    min-height: 100vh;
                    padding: 24px;
                }
                .card {
                    width: min(520px, 100%);
                    background: #fff;
                    border: 1px solid #dbe3ee;
                    border-radius: 20px;
                    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);
                    padding: 28px;
                }
                .badge {
                    display: inline-block;
                    padding: 6px 12px;
                    border-radius: 999px;
                    background: ${success ? '#dcfce7' : '#fee2e2'};
                    color: ${success ? '#166534' : '#991b1b'};
                    font-size: 12px;
                    font-weight: 700;
                    margin-bottom: 14px;
                }
                h1 {
                    margin: 0 0 10px;
                    font-size: 28px;
                }
                p {
                    margin: 0 0 20px;
                    color: #475569;
                    line-height: 1.6;
                }
                .details {
                    display: grid;
                    gap: 12px;
                    margin-top: 18px;
                }
                .detail-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 16px;
                    padding: 12px 14px;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    background: #f8fafc;
                }
                .detail-row span {
                    color: #64748b;
                    font-size: 14px;
                }
                .detail-row strong {
                    text-align: right;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <section class="card">
                <div class="badge">${success ? 'Payment Captured' : 'Payment Failed'}</div>
                <h1>${title}</h1>
                <p>${message}</p>
                <div class="details">${detailRows}</div>
            </section>
        </body>
        </html>
    `;
}

async function upsertAuthUser(User, payload) {
    if (!payload.username || !payload.password || !payload.profileId || !payload.role) {
        return;
    }

    await User.upsert({
        id: payload.id,
        profileId: payload.profileId,
        fullName: payload.fullName || '',
        campusName: payload.campusName || null,
        email: normalizeOptionalEmail(payload.email),
        username: payload.username,
        password: payload.password,
        plainPassword: payload.plainPassword || null,
        role: payload.role,
        groupKey: payload.groupKey || null,
        isActive: true
    });
}

async function syncAuthUsers() {
    const Student = sequelize.models.Student;
    const Teacher = sequelize.models.Teacher;
    const User = sequelize.models.User;

    const students = await Student.findAll({
        attributes: ['id', 'fullName', 'campusName', 'email', 'username', 'password', 'plainPassword']
    });
    for (const student of students) {
        await upsertAuthUser(User, {
            id: `student_${student.id}`,
            profileId: student.id,
            fullName: student.fullName,
            campusName: student.campusName || null,
            email: normalizeOptionalEmail(student.email),
            username: student.username,
            password: student.password,
            plainPassword: student.plainPassword || null,
            role: 'Student'
        });
    }

    const teachers = await Teacher.findAll({
        attributes: ['id', 'fullName', 'campusName', 'email', 'username', 'password', 'plainPassword', 'groupKey']
    });
    for (const teacher of teachers) {
        await upsertAuthUser(User, {
            id: `teacher_${teacher.id}`,
            profileId: teacher.id,
            fullName: teacher.fullName,
            campusName: teacher.campusName || null,
            email: normalizeOptionalEmail(teacher.email),
            username: teacher.username,
            password: teacher.password,
            plainPassword: teacher.plainPassword || null,
            groupKey: teacher.groupKey || 'teacher',
            role: 'Teacher'
        });
    }

    const Staff = sequelize.models.Staff;
    const staffMembers = await Staff.findAll({
        attributes: ['id', 'fullName', 'email', 'username', 'password', 'plainPassword', 'groupKey']
    });
    for (const member of staffMembers) {
        await upsertAuthUser(User, {
            id: `staff_${member.id}`,
            profileId: member.id,
            fullName: member.fullName,
            email: normalizeOptionalEmail(member.email),
            username: member.username,
            password: member.password,
            plainPassword: member.plainPassword || null,
            groupKey: member.groupKey || 'staff',
            role: 'Staff'
        });
    }
}

async function ensureTableColumns(tableName, columnDefinitions) {
    const queryInterface = sequelize.getQueryInterface();
    const table = await queryInterface.describeTable(tableName);

    for (const [columnName, definition] of Object.entries(columnDefinitions)) {
        if (!table[columnName]) {
            await queryInterface.addColumn(tableName, columnName, definition);
        }
    }
}

async function ensureLegacySchema() {
    await ensureTableColumns('Students', {
        studentCode: { type: DataTypes.STRING, allowNull: true },
        fullName: { type: DataTypes.STRING, allowNull: true },
        profileImage: { type: DataTypes.TEXT('long'), allowNull: true },
        fatherName: { type: DataTypes.STRING, allowNull: true },
        dob: { type: DataTypes.STRING, allowNull: true },
        admissionDate: { type: DataTypes.STRING, allowNull: true },
        classGrade: { type: DataTypes.STRING, allowNull: true },
        campusName: { type: DataTypes.STRING, allowNull: true },
        gender: { type: DataTypes.STRING, allowNull: true },
        parentPhone: { type: DataTypes.STRING, allowNull: true },
        nonDigital: { type: DataTypes.BOOLEAN, allowNull: true },
        email: { type: DataTypes.STRING, allowNull: true },
        rollNo: { type: DataTypes.STRING, allowNull: true },
        formB: { type: DataTypes.STRING, allowNull: true },
        monthlyFee: { type: DataTypes.STRING, allowNull: true },
        feeFrequency: { type: DataTypes.STRING, allowNull: true },
        feesStatus: { type: DataTypes.STRING, allowNull: true },
        paymentDate: { type: DataTypes.STRING, allowNull: true },
        username: { type: DataTypes.STRING, allowNull: true },
        password: { type: DataTypes.STRING, allowNull: true },
        plainPassword: { type: DataTypes.STRING, allowNull: true },
        role: { type: DataTypes.STRING, allowNull: true }
    });

    await ensureTableColumns('Users', {
        fullName: { type: DataTypes.STRING, allowNull: true },
        campusName: { type: DataTypes.STRING, allowNull: true },
        email: { type: DataTypes.STRING, allowNull: true },
        username: { type: DataTypes.STRING, allowNull: false },
        password: { type: DataTypes.STRING, allowNull: false },
        plainPassword: { type: DataTypes.STRING, allowNull: true },
        groupKey: { type: DataTypes.STRING, allowNull: true },
        role: { type: DataTypes.STRING, allowNull: false },
        isActive: { type: DataTypes.BOOLEAN, allowNull: true }
    });

    await ensureTableColumns('Teachers', {
        employeeCode: { type: DataTypes.STRING, allowNull: true },
        fullName: { type: DataTypes.STRING, allowNull: true },
        profileImage: { type: DataTypes.TEXT('long'), allowNull: true },
        fatherName: { type: DataTypes.STRING, allowNull: true },
        dob: { type: DataTypes.STRING, allowNull: true },
        cnic: { type: DataTypes.STRING, allowNull: true },
        phone: { type: DataTypes.STRING, allowNull: true },
        email: { type: DataTypes.STRING, allowNull: true },
        address: { type: DataTypes.TEXT, allowNull: true },
        qualification: { type: DataTypes.STRING, allowNull: true },
        campusName: { type: DataTypes.STRING, allowNull: true },
        gender: { type: DataTypes.STRING, allowNull: true },
        designation: { type: DataTypes.STRING, allowNull: true },
        subject: { type: DataTypes.STRING, allowNull: true },
        salary: { type: DataTypes.STRING, allowNull: true },
        idCardFront: { type: DataTypes.TEXT('long'), allowNull: true },
        idCardBack: { type: DataTypes.TEXT('long'), allowNull: true },
        cvFile: { type: DataTypes.TEXT('long'), allowNull: true },
        bankName: { type: DataTypes.STRING, allowNull: true },
        bankAccountTitle: { type: DataTypes.STRING, allowNull: true },
        bankAccountNumber: { type: DataTypes.STRING, allowNull: true },
        bankBranch: { type: DataTypes.STRING, allowNull: true },
        schedule: { type: DataTypes.TEXT('long'), allowNull: true },
        username: { type: DataTypes.STRING, allowNull: true },
        password: { type: DataTypes.STRING, allowNull: true },
        plainPassword: { type: DataTypes.STRING, allowNull: true },
        groupKey: { type: DataTypes.STRING, allowNull: true },
        role: { type: DataTypes.STRING, allowNull: true }
    });

    await ensureTableColumns('Staffs', {
        employeeCode: { type: DataTypes.STRING, allowNull: true },
        fullName: { type: DataTypes.STRING, allowNull: true },
        fatherName: { type: DataTypes.STRING, allowNull: true },
        dob: { type: DataTypes.STRING, allowNull: true },
        designation: { type: DataTypes.STRING, allowNull: true },
        cnic: { type: DataTypes.STRING, allowNull: true },
        phone: { type: DataTypes.STRING, allowNull: true },
        email: { type: DataTypes.STRING, allowNull: true },
        address: { type: DataTypes.TEXT, allowNull: true },
        gender: { type: DataTypes.STRING, allowNull: true },
        salary: { type: DataTypes.STRING, allowNull: true },
        idCardFront: { type: DataTypes.TEXT('long'), allowNull: true },
        idCardBack: { type: DataTypes.TEXT('long'), allowNull: true },
        bankName: { type: DataTypes.STRING, allowNull: true },
        bankAccountTitle: { type: DataTypes.STRING, allowNull: true },
        bankAccountNumber: { type: DataTypes.STRING, allowNull: true },
        bankBranch: { type: DataTypes.STRING, allowNull: true },
        username: { type: DataTypes.STRING, allowNull: true },
        password: { type: DataTypes.STRING, allowNull: true },
        plainPassword: { type: DataTypes.STRING, allowNull: true },
        groupKey: { type: DataTypes.STRING, allowNull: true },
        role: { type: DataTypes.STRING, allowNull: true }
    });

    await ensureTableColumns('Messages', {
        subject: { type: DataTypes.STRING, allowNull: false },
        body: { type: DataTypes.TEXT('long'), allowNull: false },
        targetRole: { type: DataTypes.STRING, allowNull: false },
        targetScope: { type: DataTypes.STRING, allowNull: false },
        campusName: { type: DataTypes.STRING, allowNull: true },
        classGrade: { type: DataTypes.STRING, allowNull: true },
        recipientId: { type: DataTypes.STRING, allowNull: true },
        recipientName: { type: DataTypes.STRING, allowNull: true },
        senderName: { type: DataTypes.STRING, allowNull: true },
        thread: { type: DataTypes.TEXT('long'), allowNull: true },
        chatStatus: { type: DataTypes.STRING, allowNull: true },
        createdAtLabel: { type: DataTypes.STRING, allowNull: true }
    });

    await ensureTableColumns('Banners', {
        placement: { type: DataTypes.STRING, allowNull: true, defaultValue: 'banner' },
        linkUrl: { type: DataTypes.STRING, allowNull: true }
    });

    await ensureTableColumns('LeaveRequests', {
        applicantName: { type: DataTypes.STRING, allowNull: true },
        email: { type: DataTypes.STRING, allowNull: true },
        studentCode: { type: DataTypes.STRING, allowNull: true },
        rollNo: { type: DataTypes.STRING, allowNull: true },
        classGrade: { type: DataTypes.STRING, allowNull: true },
        subject: { type: DataTypes.STRING, allowNull: true },
        campusName: { type: DataTypes.STRING, allowNull: true },
        fileName: { type: DataTypes.STRING, allowNull: true },
        fileType: { type: DataTypes.STRING, allowNull: true },
        fileData: { type: DataTypes.TEXT('long'), allowNull: true },
        reviewReason: { type: DataTypes.TEXT, allowNull: true },
        reviewedAt: { type: DataTypes.STRING, allowNull: true },
        reviewEmailSentAt: { type: DataTypes.STRING, allowNull: true }
    });
}

async function startServer() {
    if (startupPromise) {
        return startupPromise;
    }

    startupPromise = (async () => {
    try {
        console.log('Initializing database...');
        await initializeDatabase();

        sequelize = new Sequelize(
            process.env.DB_NAME || 'school_system',
            process.env.DB_USER || 'root',
            process.env.DB_PASSWORD || '',
            {
                host: process.env.DB_HOST || 'localhost',
                port: Number(process.env.DB_PORT || 3306),
                dialect: 'mysql',
                logging: false
            }
        );

        defineStudentModel(sequelize);
        defineTeacherModel(sequelize);
        defineUserModel(sequelize);
        defineStaffModel(sequelize);
        defineFeePaymentModel(sequelize);
        defineFeeDueBalanceModel(sequelize);
        defineClassFeeModel(sequelize);
        defineStudentAttendanceModel(sequelize);
        defineTeacherAttendanceModel(sequelize);
        defineLeaveRequestModel(sequelize);
        defineSpecialNoticeModel(sequelize);
        defineBannerModel(sequelize);
        defineMessageModel(sequelize);

        // Avoid Sequelize's repeated ALTER-based index churn on MySQL.
        // Missing legacy columns are handled separately in ensureLegacySchema().
        await sequelize.sync();
        await ensureLegacySchema();
        await syncAuthUsers();
        console.log('✅ Database synced successfully');

        isInitialized = true;
    } catch (err) {
        startupPromise = null;
        console.error('Database connection error:', err.message);
        console.log('Ensure MySQL is running and .env credentials are correct.');
        throw err;
    }
    })();

    return startupPromise;
}

module.exports = {
    app,
    attachSocketServer,
    startServer,
    server,
    getIo: () => io,
    getSequelize: () => sequelize,
    isInitialized: () => isInitialized
};
