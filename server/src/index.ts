import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import path from 'path';

import { setupPassport } from './lib/passport';
import { errorHandler } from './middleware/errorHandler';
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

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/import', importRoutes);
app.use('/api/overtime', overtimeRoutes);
app.use('/api/companies', companiesRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, env: process.env.NODE_ENV }));

// ── Serve React in production ─────────────────────────────────────────────────
if (isProd) {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`HRConnect server running on port ${PORT} [${process.env.NODE_ENV}]`);
  startLeaveAccrualJob();
});

export default app;
