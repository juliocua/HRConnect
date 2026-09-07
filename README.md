# HRConnect

A full-stack HR Information System built for Philippine companies. Covers employee records, attendance tracking, leave management, and payroll computation compliant with TRAIN Law 2023+.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + TypeScript + React Router v6 + TanStack Query v5 |
| Backend | Node.js + Express + TypeScript + Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT (email/password) + Google OAuth + Microsoft OAuth |
| Deployment | Railway (single service — API + static build) |

---

## Project structure

```
hrconnect/
├── client/           React frontend (Vite)
│   └── src/
│       ├── components/   Layout, Sidebar, TopBar
│       ├── context/      AuthContext (JWT + OAuth callback)
│       ├── lib/          axios instance, payroll math
│       ├── pages/        Dashboard, Employees, Attendance, Leave, Payroll
│       └── types/        Shared TypeScript types
├── server/           Express backend
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src/
│       ├── lib/          prisma client, JWT helpers, payroll, passport
│       ├── middleware/   authenticate, requireRole
│       └── routes/       auth, employees, attendance, leave, payroll
├── .env.example
├── railway.json
└── package.json      (npm workspaces root)
```

---

## Local setup

### 1. Clone and install

```bash
git clone <repo>
cd hrconnect
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@localhost:5432/hrconnect"

# JWT — generate a long random string
JWT_SECRET="replace-with-a-very-long-random-secret"
SESSION_SECRET="another-random-secret"

# OAuth — optional; omit to disable that provider
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
MICROSOFT_CLIENT_ID=""
MICROSOFT_CLIENT_SECRET=""
MICROSOFT_TENANT_ID="common"

# Frontend URL (used for OAuth callback redirect)
CLIENT_URL="http://localhost:5173"
```

### 3. Set up the database

```bash
cd server
npx prisma migrate dev --name init
npx prisma db seed
cd ..
```

### 4. Run in development

```bash
npm run dev
```

This starts both the Vite dev server (port 5173) and the Express API (port 3001) in parallel.

### Default admin login

After seeding, log in at http://localhost:5173/login with:
- **Email:** admin@company.ph
- **Password:** admin1234

---

## OAuth setup

### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth 2.0 Client ID
2. Authorized redirect URI: `http://localhost:3001/api/auth/google/callback` (and your production domain)
3. Copy Client ID and Secret into `.env`

### Microsoft (Azure AD)

1. Go to [Azure Portal](https://portal.azure.com/) → App registrations → New registration
2. Redirect URI: `http://localhost:3001/api/auth/microsoft/callback` (platform: Web)
3. Create a client secret under Certificates & secrets
4. Copy Application (client) ID, client secret, and Directory (tenant) ID into `.env`
5. Set `MICROSOFT_TENANT_ID` to `common` (for multi-tenant) or your specific tenant ID

---

## Deploying to Railway

### 1. Create a Railway project

```bash
npm install -g @railway/cli
railway login
railway init
```

### 2. Provision a PostgreSQL database

In the Railway dashboard: Add Service → Database → PostgreSQL. Copy the `DATABASE_URL` from the Variables tab.

### 3. Set environment variables

In Railway dashboard → your service → Variables, add all values from `.env.example`:
- `DATABASE_URL` (from the Postgres service)
- `JWT_SECRET`, `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
- `CLIENT_URL` → your Railway public URL (e.g. `https://hrconnect.up.railway.app`)
- `NODE_ENV=production`

### 4. Update OAuth redirect URIs

In Google Cloud Console and Azure Portal, add the production callback URLs:
- `https://your-app.up.railway.app/api/auth/google/callback`
- `https://your-app.up.railway.app/api/auth/microsoft/callback`

### 5. Deploy

```bash
railway up
```

Railway will:
1. Run `npm install && npm run build` (builds client → `client/dist`, compiles server)
2. Run `npx prisma migrate deploy` and seeder on first deploy
3. Serve the Express API + static React files on a single port

---

## Modules

### Employee Records
- Full CRUD with department assignment, manager hierarchy, and subordinates view
- Government ID fields: SSS, PhilHealth, Pag-IBIG, TIN
- Soft-delete: employees are marked `TERMINATED` rather than deleted
- Avatar color picker, auto-generated employee numbers (`EMP-XXXX`)

### Attendance
- Daily attendance logging per employee
- Statuses: Present, Late, Absent, Half Day, On Leave, Holiday, Weekend
- Overtime hours tracking
- Upsert-safe: re-submitting the same date overwrites the record

### Leave Management
- Six default leave types: Vacation (VL), Sick (SL), Emergency (EL), Maternity (ML), Paternity (PL), Service Incentive (SIL)
- Pending-days reservation prevents over-booking before approval
- Atomic approve/reject using Prisma transactions — balance is updated in the same DB transaction as the status change
- Per-employee, per-year leave balance dashboard

### Payroll (TRAIN Law)
Philippine statutory deductions computed automatically:

| Contribution | Rate | Cap |
|---|---|---|
| SSS | 4.5% of MSC | MSC: ₱5,000–₱35,000 |
| PhilHealth | 2.5% of basic | Min ₱500, max ₱2,500 |
| Pag-IBIG | 2% of basic | Max ₱200 |
| Withholding tax | BIR graduated brackets | TRAIN Law 2023+ |

Payroll flow: **Draft** → **Posted** → **Paid**. Only HR Managers and Super Admins can run or post payroll. Individual payslips viewable per record.

---

## API reference

All API routes are under `/api`. Protected routes require `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Create account |
| POST | `/auth/login` | public | Email/password login → JWT |
| GET | `/auth/me` | JWT | Get current user |
| GET | `/auth/google` | public | Google OAuth redirect |
| GET | `/auth/microsoft` | public | Microsoft OAuth redirect |
| GET | `/employees` | JWT | List employees (search, dept, status filters) |
| POST | `/employees` | JWT | Create employee |
| GET | `/employees/:id` | JWT | Get employee with manager + subordinates |
| PUT | `/employees/:id` | JWT | Update employee |
| DELETE | `/employees/:id` | JWT | Soft-delete (set TERMINATED) |
| GET | `/employees/departments/list` | JWT | List departments |
| POST | `/employees/departments` | JWT | Create department |
| GET | `/attendance` | JWT | List attendance (date, employeeId filters) |
| POST | `/attendance` | JWT | Upsert attendance record |
| PUT | `/attendance/:id` | JWT | Update record |
| POST | `/attendance/bulk` | JWT | Bulk upsert |
| GET | `/leave/types` | JWT | List leave types |
| GET | `/leave` | JWT | List requests (status, employeeId filters) |
| GET | `/leave/balances/:employeeId` | JWT | Get leave balances |
| POST | `/leave` | JWT | File leave request |
| PUT | `/leave/:id/approve` | JWT | Approve (transaction) |
| PUT | `/leave/:id/reject` | JWT | Reject with note (transaction) |
| GET | `/payroll` | JWT | Get runs by year/month |
| GET | `/payroll/history` | JWT | All payroll runs |
| POST | `/payroll/run` | HR Manager+ | Compute & create payroll run |
| PUT | `/payroll/:runId/post` | HR Manager+ | Post draft payroll |
| GET | `/payroll/employee/:id` | JWT | Employee payroll history |

---

## User roles

| Role | Capabilities |
|---|---|
| `SUPER_ADMIN` | Full access including payroll run/post |
| `HR_MANAGER` | Full access including payroll run/post |
| `HR_STAFF` | Read/write employees, attendance, leave. Cannot run payroll. |

---

## License

MIT — free to use for internal systems.
