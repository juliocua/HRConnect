import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

function fmt(amount: number) {
  return amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDateAbbrev(iso: string | Date) {
  const d = new Date(iso);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Convert a number to Philippine peso words, e.g. 90935.41 → "Ninety Thousand Nine Hundred Thirty Five Pesos & 41/100 Only." */
function amountInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function say(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' ';
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred ' + say(n % 100);
    if (n < 1000000) return say(Math.floor(n / 1000)) + 'Thousand ' + say(n % 1000);
    if (n < 1000000000) return say(Math.floor(n / 1000000)) + 'Million ' + say(n % 1000000);
    return say(Math.floor(n / 1000000000)) + 'Billion ' + say(n % 1000000000);
  }

  const rounded = Math.round(amount * 100) / 100;
  const pesos   = Math.floor(rounded);
  const centavos = Math.round((rounded - pesos) * 100);
  const words   = say(pesos).trim() || 'Zero';
  return `${words} Pesos & ${String(centavos).padStart(2, '0')}/100 Only.`;
}

export interface CompanyInfo {
  companyName?: string | null;
  address?: string | null;
  contactNumber?: string | null;
  logoUrl?: string | null;
}

export async function generateInvoicePDF(
  billing: any,
  company?: CompanyInfo,
  _thirteenthMap?: Map<string, number>,  // kept for API compat, not shown in SOA
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW   = doc.page.width;
    const margin  = 40;
    const contentW = pageW - margin * 2;
    const dark    = '#111827';
    const muted   = '#4B5563';
    const soaBarBg = '#1F2937';
    const labelCol = '#374151';

    const companyName    = company?.companyName || 'HRConnect';
    const companyAddress = company?.address || '';
    const companyPhone   = company?.contactNumber || '';

    // Bank env vars
    const bankCompany = process.env.BANK_ACCOUNT_NAME || companyName;
    const bankName    = process.env.BANK_NAME || '';
    const bankAcct    = process.env.BANK_ACCOUNT_NUMBER || '';

    // ── Try to load logo ──────────────────────────────────────────────────────
    let logoBuffer: Buffer | null = null;
    if (company?.logoUrl) {
      try {
        const filename    = path.basename(company.logoUrl);
        const uploadsBase = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        const logoPath    = path.join(uploadsBase, 'logos', filename);
        if (fs.existsSync(logoPath)) logoBuffer = fs.readFileSync(logoPath);
      } catch { /* non-fatal */ }
    }

    // ── Draw outer border ─────────────────────────────────────────────────────
    doc.rect(margin, margin, contentW, doc.page.height - margin * 2)
      .strokeColor('#9CA3AF').lineWidth(1).stroke();

    const innerX = margin + 12;
    const innerW = contentW - 24;
    let y = margin + 12;

    // ── Company header ────────────────────────────────────────────────────────
    const logoH = 50;
    if (logoBuffer) {
      doc.image(logoBuffer, innerX, y, { height: logoH });
    }

    const textX = logoBuffer ? innerX + logoH + 12 : innerX;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(dark).text(companyName.toUpperCase(), textX, y + 4, { width: innerW - (logoBuffer ? logoH + 12 : 0) });
    let infoY = y + 20;
    if (companyAddress) {
      doc.font('Helvetica').fontSize(8).fillColor(muted).text(companyAddress, textX, infoY, { width: innerW - (logoBuffer ? logoH + 12 : 0) });
      infoY += 11;
    }
    if (companyPhone) {
      doc.font('Helvetica').fontSize(8).fillColor(muted).text(`TEL NO. ${companyPhone}`, textX, infoY, { width: innerW - (logoBuffer ? logoH + 12 : 0) });
    }

    y = Math.max(y + logoH, infoY) + 14;

    // ── Divider ───────────────────────────────────────────────────────────────
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    y += 10;

    // ── Client info rows ──────────────────────────────────────────────────────
    // Compute billing period
    const billingDateObj  = new Date(billing.billingDate);
    const periodEndDate   = new Date(billingDateObj);
    const periodStartDate = new Date(billingDateObj);
    periodStartDate.setDate(periodStartDate.getDate() - 30);

    const labelW    = 110;
    const valueX    = innerX + labelW;
    const rightColX = margin + contentW / 2 + 20;
    const rightLblW = 90;
    const rightValX = rightColX + rightLblW;

    function infoRow(label: string, value: string, rightLabel?: string, rightValue?: string) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(labelCol).text(label, innerX, y, { width: labelW, continued: false });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(value, valueX, y, { width: rightColX - valueX - 10 });
      if (rightLabel) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(labelCol).text(rightLabel, rightColX, y, { width: rightLblW });
        doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(rightValue ?? '', rightValX, y, { width: margin + contentW - rightValX - 10, align: 'right' });
      }
      y += 15;
    }

    infoRow('COMPANY NAME:', billing.client.name.toUpperCase(), 'PAYROLL DATE:', fmtDate(billing.billingDate).toUpperCase());
    infoRow('ATTENTION TO:', billing.client.contactName || '', 'SOA NO.', billing.soaNo ?? `SOA-${billing.id.slice(-8).toUpperCase()}`);
    infoRow('POSITION:', billing.client.clientSignatoryTitle || '', '', '');
    y += 4;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(labelCol).text('ADDRESS:', innerX, y, { width: labelW });
    doc.font('Helvetica').fontSize(9).fillColor(dark).text(billing.client.address || '', valueX, y, { width: innerW - labelW });
    y += 18;

    // ── "STATEMENT OF ACCOUNT" bar ────────────────────────────────────────────
    const barH = 22;
    doc.rect(margin, y, contentW, barH).fill(soaBarBg);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
      .text('STATEMENT OF ACCOUNT', margin, y + 6, { width: contentW, align: 'center' });
    y += barH;

    // ── Billing table ─────────────────────────────────────────────────────────
    const descX   = innerX;
    const periodX = innerX + 160;
    const amtX    = margin + contentW - 12;
    const rowH    = 18;

    function billingRow(desc: string, period: string, amount: string | null, bold = false, drawLine = true) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(dark);
      doc.text(desc, descX, y + 4, { width: 155 });
      if (period) doc.text(period, periodX, y + 4, { width: amtX - periodX - 90 });
      if (amount !== null) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(dark)
          .text(amount, descX, y + 4, { width: amtX - descX, align: 'right' });
      }
      y += rowH;
      if (drawLine) {
        doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#D1D5DB').lineWidth(0.3).stroke();
      }
    }

    // Compute financial figures
    const serviceRendered = billing.grossBill ?? billing.amount ?? 0;
    const adminFeeRate    = billing.client?.adminFeeRate ?? 0;
    const adminFeeAmt     = Math.round(serviceRendered * adminFeeRate / 100 * 100) / 100;
    const netTotalBill    = Math.round((serviceRendered + adminFeeAmt) * 100) / 100;
    const vatAmount       = billing.vatAmount ?? (billing.client?.isVatable ? Math.round(netTotalBill * 0.12 * 100) / 100 : 0);
    const ewtAmount       = billing.ewtAmount ?? (billing.client?.hasEwt ? Math.round(netTotalBill * 0.02 * 100) / 100 : 0);
    const totalAmountDue  = Math.round((netTotalBill + vatAmount - ewtAmount) * 100) / 100;

    const cutOffPeriod = `CUT OFF PERIOD:  ${fmtDateAbbrev(periodStartDate).toUpperCase()}-${fmtDateAbbrev(periodEndDate).toUpperCase()}`;

    billingRow('SERVICE RENDERED:', cutOffPeriod, fmt(serviceRendered));
    if (adminFeeAmt > 0) {
      billingRow(`${adminFeeRate}%  ADMIN FEE`, '', fmt(adminFeeAmt));
    }
    // Net total bill — bold line
    billingRow('Net total bill', '', fmt(netTotalBill), true);
    y += 4;
    billingRow('Add: 12% Vat', '', vatAmount > 0 ? fmt(vatAmount) : '-');
    billingRow('Less: 2% EWT', '', ewtAmount > 0 ? fmt(ewtAmount) : '-');
    billingRow('ATD Charges', '', '-');
    y += 2;

    // TOTAL AMOUNT DUE — bold, slightly larger
    doc.rect(margin, y, contentW, 20).fill('#F3F4F6');
    doc.font('Helvetica-Bold').fontSize(10).fillColor(dark)
      .text('TOTAL AMOUNT DUE', descX, y + 5, { width: amtX - descX - 2, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(dark)
      .text(fmt(totalAmountDue), descX, y + 5, { width: amtX - descX, align: 'right' });
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    y += 20;
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    y += 10;

    // ── Amount in words ───────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text('AMOUNT IN WORDS:', innerX, y);
    y += 13;
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(dark)
      .text(amountInWords(totalAmountDue), innerX, y, { width: innerW });
    y += 24;

    // ── Signatories ───────────────────────────────────────────────────────────
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#D1D5DB').lineWidth(0.3).stroke();
    y += 14;

    // Left side: Prepared by, Checked by, Noted by (stacked)
    // Right side: Received by (aligned to right half)
    const sigLeftW  = contentW * 0.55;
    const sigRightX = margin + sigLeftW + 20;
    const sigRightW = contentW - sigLeftW - 20;
    const sigLineW  = 160;

    function leftSig(label: string, name: string, title: string) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(label, innerX, y);
      y += 28;
      doc.moveTo(innerX, y).lineTo(innerX + sigLineW, y).strokeColor(dark).lineWidth(0.5).stroke();
      y += 4;
      if (name) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(name, innerX, y, { width: sigLineW });
        y += 12;
      }
      if (title) {
        doc.font('Helvetica').fontSize(8).fillColor(muted).text(title, innerX, y, { width: sigLineW });
        y += 16;
      }
    }

    const startY = y;
    leftSig('Prepared by:', '', '');
    leftSig('Checked by:', '', '');
    leftSig('Noted by:', '', '');

    // Right side: Received by
    const recY = startY;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text('Received by:', sigRightX, recY);
    const recLineY = recY + 40;
    doc.moveTo(sigRightX, recLineY).lineTo(sigRightX + sigLineW, recLineY).strokeColor(dark).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(muted)
      .text('Signature over Printed Name', sigRightX, recLineY + 4, { width: sigLineW, align: 'center' });
    if (billing.client?.clientSignatoryName) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(dark)
        .text(billing.client.clientSignatoryName, sigRightX, recLineY + 18, { width: sigLineW });
      if (billing.client?.clientSignatoryTitle) {
        doc.font('Helvetica').fontSize(8).fillColor(muted)
          .text(billing.client.clientSignatoryTitle, sigRightX, recLineY + 30, { width: sigLineW });
      }
    }

    y = Math.max(y, recLineY + 50) + 10;

    // ── Bank note ─────────────────────────────────────────────────────────────
    if (bankName || bankAcct) {
      doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#D1D5DB').lineWidth(0.3).stroke();
      y += 8;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#DC2626').text('NOTE:', innerX, y);
      y += 12;
      doc.font('Helvetica').fontSize(8).fillColor(dark)
        .text(`CHECK PAYMENT PAYABLE TO: ${bankCompany.toUpperCase()}`, innerX, y);
      y += 11;
      if (bankName) {
        doc.font('Helvetica').fontSize(8).fillColor(dark).text(`BANK NAME: ${bankName.toUpperCase()}`, innerX, y);
        y += 11;
      }
      if (bankAcct) {
        doc.font('Helvetica').fontSize(8).fillColor(dark).text(`ACCOUNT NUMBER: ${bankAcct}`, innerX, y);
      }
    }

    doc.end();
  });
}
