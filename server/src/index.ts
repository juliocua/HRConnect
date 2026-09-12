import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import path from 'path';

import { setupPassport } from './lib/passport';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/authenticate';
import { rbacGuard } from './middleware/rbac';
import authRoutes from './routes/auth';
import employeeRoutes from './routes/employees';
import attendanceRoutes from './routes/attendance';
import leaveRoutes from './routes/leave';
import payrollRoutes from './routes/payroll';
import clientRoutes from './routes/clients';
import billingRoutes from './routes/billing';
import importRoutes from './routes/import';
import overtimeRoutes from './routes/overtime';
import companiesRoutes from './routes/companies';
import { startLeaveAccrualJob } from './jobs/leaveAccrual';

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const isProd = process.env.NODE_ENV === 'production';

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: isProd }));
app.use(cors({ origin: CLIENT_URL, credentials: true }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Sessions (needed for OAuth redirect flow) ─────────────────────────────────
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProd, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// ── Passport ──────────────────────────────────────────────────────────────────
setupPassport();
app.use(passport.initialize());
app.use(passport.session());

// ── Static: uploaded files ────────────────────────────────────────────────────
const uploadsBase = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
app.use('/uploads', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadsBase));

// ── Auth routes (no RBAC — login, register, OTP, /me) ────────────────────────
app.use('/api/auth', authRoutes);

// ── Protected API routes (authenticate → RBAC → route handler) ───────────────
// authenticate verifies the JWT and sets req.user; rbacGuard checks module access.
// Individual route handlers may call authenticate again internally — that is harmless.
app.use('/api/employees', authenticate, rbacGuard('employees'), employeeRoutes);
app.use('/api/attendance', authenticate, rbacGuard('attendance'), attendanceRoutes);
app.use('/api/leave',      authenticate, rbacGuard('leave'),      leaveRoutes);
app.use('/api/payroll',    authenticate, rbacGuard('payroll'),    payrollRoutes);
app.use('/api/clients',    authenticate, rbacGuard('clients'),    clientRoutes);
app.use('/api/billing',    authenticate, rbacGuard('billing'),    billingRoutes);
app.use('/api/import',     authenticate, rbacGuard('import'),     importRoutes);
app.use('/api/overtime',   authenticate, rbacGuard('overtime'),   overtimeRoutes);
app.use('/api/companies',  authenticate, rbacGuard('companies'),  companiesRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, env: process.env.NODE_ENV }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`HRConnect server running on port ${PORT} [${process.env.NODE_ENV}]`);
  startLeaveAccrualJob();
});

export default app;
