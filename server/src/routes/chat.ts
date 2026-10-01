import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// ── POST /api/chat ────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, history = [] } = req.body as {
      message: string;
      history: { role: 'user' | 'model'; parts: { text: string }[] }[];
    };

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get Gemini API key from app settings
    const keySetting = await (prisma as any).appSetting.findUnique({
      where: { key: 'geminiApiKey' },
    });
    const apiKey = keySetting?.value?.trim();
    if (!apiKey) {
      return res.status(503).json({
        error: 'AI assistant is not configured. Ask your admin to add a Gemini API key in Global Setup → AI.',
      });
    }

    // Build context from live app data
    const [
      employeeCount,
      clientCount,
      pendingLeaves,
      pendingOvertime,
      latestPayroll,
    ] = await Promise.all([
      (prisma as any).employee.count({ where: { isActive: true } }),
      (prisma as any).client?.count({ where: { isActive: true } }).catch(() => 0),
      (prisma as any).leaveRequest.count({ where: { status: 'PENDING' } }),
      (prisma as any).overtimeRequest.count({ where: { status: 'PENDING' } }),
      (prisma as any).payrollRun.findFirst({ orderBy: { id: 'desc' } }),
    ]);

    const systemInstruction = `You are HRConnect AI — an intelligent assistant embedded in HRConnect, an HR Information System for Philippine-based companies managed by NuageCG.

Live system snapshot:
- Active employees: ${employeeCount}
- Active clients: ${clientCount ?? 'N/A'}
- Pending leave requests: ${pendingLeaves}
- Pending overtime requests: ${pendingOvertime}
- Latest payroll run: ${latestPayroll ? `${(latestPayroll as any).period ?? (latestPayroll as any).description ?? 'recent'} — status: ${(latestPayroll as any).status}` : 'No payroll runs yet'}

You help HR staff and employees with:
- Payroll computations (basic pay, overtime at 125%, night differential 10%, 13th month pay)
- Philippine statutory deductions: SSS (employee 4.5%, ceiling ₱30,000), PhilHealth (2.5%, max ₱2,500), Pag-IBIG (2%, max ₱200)
- Withholding tax (BIR graduated table, monthly/semi-monthly)
- Attendance, overtime, and leave management (DOLE regulations, Philippine Labor Code)
- Employee records, documentation, and HR processes
- How to use HRConnect features and navigate modules

When users ask about specific employee records or payroll data, guide them to the relevant module.
Be concise, friendly, and accurate. Use Philippine peso (₱) for amounts. Cite legal basis when relevant (Labor Code, BIR RR, etc.).`;

    const geminiPayload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.json().catch(() => ({}));
      console.error('[Chat] Gemini API error:', geminiRes.status, errBody);
      const msg = (errBody as any)?.error?.message;
      return res.status(502).json({
        error: msg
          ? `Gemini error: ${msg}`
          : 'AI service returned an error. Check the API key or try again.',
      });
    }

    const data = await geminiRes.json();
    const reply =
      (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ??
      'Sorry, I could not generate a response. Please try again.';

    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

export default router;
