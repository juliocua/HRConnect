import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

function fmt(amount: number) {
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
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
  thirteenthMap?: Map<string, number>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const primary   = '#1E3A5F';
    const accent    = '#2563EB';
    const muted     = '#6B7280';
    const dark      = '#111827';
    const lineColor = '#D1D5DB';

    const companyName    = company?.companyName || 'HRConnect';
    const companyAddress = company?.address || '';
    const companyPhone   = company?.contactNumber || '';

    const pageW  = doc.page.width;
    const pageH  = doc.page.height;
    const margin = 50;
    const contentW = pageW - margin * 2;

    // ── Try to load logo ──────────────────────────────────────────────────────
    let logoBuffer: Buffer | null = null;
    if (company?.logoUrl) {
      try {
        const filename  = path.basename(company.logoUrl);
        const uploadsBase = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        const logoPath  = path.join(uploadsBase, 'logos', filename);
        if (fs.existsSync(logoPath)) logoBuffer = fs.readFileSync(logoPath);
      } catch { /* non-fatal */ }
    }

    // ── Header bar ────────────────────────────────────────────────────────────
    doc.rect(0, 0, pageW, 8).fill(primary);

    const logoSize = 52;
    const textX = logoBuffer ? margin + logoSize + 14 : margin;

    if (logoBuffer) {
      doc.image(logoBuffer, margin, 20, { width: logoSize, height: logoSize });
    }

    doc.font('Helvetica-Bold').fontSize(18).fillColor(primary).text(companyName, textX, 28);
    let subY = 50;
    if (companyAddress) {
      doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(companyAddress, textX, subY);
      subY += 12;
    }
    if (companyPhone) {
      doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(companyPhone, textX, subY);
      subY += 12;
    }

    // SOA label — right side
    doc.font('Helvetica-Bold').fontSize(22).fillColor(accent)
      .text('STATEMENT OF ACCOUNT', 0, 30, { align: 'right' });

    // ── Divider ───────────────────────────────────────────────────────────────
    let y = Math.max(subY + 10, 82);
    doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(lineColor).lineWidth(1).stroke();
    y += 16;

    // ── SOA Details block ─────────────────────────────────────────────────────
    // Left column: client info | Right column: SOA reference
    const halfW = (contentW - 20) / 2;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('BILLED TO', margin, y);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('SOA DETAILS', margin + halfW + 20, y);
    y += 14;

    doc.font('Helvetica-Bold').fontSize(13).fillColor(dark).text(billing.client.name, margin, y, { width: halfW });
    const soaRightX = margin + halfW + 20;

    // Compute period dates
    const billingDateObj = new Date(billing.billingDate);
    const periodEndDate  = billingDateObj;
    const periodStartDate = new Date(billingDateObj);
    periodStartDate.setDate(periodStartDate.getDate() - 30);

    const detailRows: { label: string; value: string }[] = [
      { label: 'SOA No.',       value: billing.soaNo ?? `SOA-${billing.id.slice(-8).toUpperCase()}` },
      { label: 'Billing Date',  value: fmtDate(billing.billingDate) },
      { label: 'Period',        value: `${fmtDate(periodStartDate)} – ${fmtDate(periodEndDate)}` },
      { label: 'Status',        value: billing.status },
    ];

    let detailY = y;
    for (const row of detailRows) {
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(row.label + ':', soaRightX, detailY, { width: 80 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(row.value, soaRightX + 84, detailY, { width: halfW - 84 });
      detailY += 14;
    }

    if (billing.client.address) {
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(billing.client.address, margin, y + 16, { width: halfW });
    }

    y = Math.max(detailY, y + 50) + 20;

    // ── Financial Summary ─────────────────────────────────────────────────────
    doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(lineColor).lineWidth(0.5).stroke();
    y += 0;

    // Section header
    doc.rect(margin, y, contentW, 22).fill('#F1F5F9');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(primary)
      .text('BILLING SUMMARY', margin + 8, y + 7);
    y += 22;

    const grossBill  = billing.grossBill ?? billing.amount ?? 0;
    const vatAmount  = billing.vatAmount ?? 0;
    const ewtAmount  = billing.ewtAmount ?? 0;
    const totalNetBill = billing.totalNetBill ?? grossBill;
    const amountPaid = billing.amountPaid ?? 0;
    const balanceDue = Math.round((totalNetBill - amountPaid) * 100) / 100;

    const labelX   = margin + 8;
    const amtX     = pageW - margin - 160;
    const amtWidth = 150;

    function summaryRow(label: string, amount: number, bold = false, highlight = false) {
      if (bold || highlight) {
        const rowH = 26;
        if (highlight) {
          doc.rect(margin, y, contentW, rowH).fill(primary);
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
            .text(label, labelX, y + 8)
            .text(fmt(amount), amtX, y + 8, { width: amtWidth, align: 'right' });
        } else {
          doc.font('Helvetica-Bold').fontSize(10).fillColor(dark)
            .text(label, labelX, y + 6)
            .text(fmt(amount), amtX, y + 6, { width: amtWidth, align: 'right' });
        }
        y += rowH;
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(dark)
          .text(label, labelX, y + 5)
          .font('Helvetica').text(fmt(amount), amtX, y + 5, { width: amtWidth, align: 'right' });
        y += 22;
      }
      doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(lineColor).lineWidth(0.3).stroke();
    }

    summaryRow('Gross Billing Amount', grossBill);
    if (vatAmount) summaryRow('VAT (12%)', vatAmount);
    if (ewtAmount) summaryRow('EWT (2%)', -ewtAmount);
    summaryRow('Total Net Bill', totalNetBill, true);
    summaryRow('Amount Paid', amountPaid);
    summaryRow('Balance Due', balanceDue, false, true);

    y += 24;

    // ── 13th Month Reference ─────────────────────────────────────────────────
    const employees: any[] = billing.client?.employees ?? [];
    const hasTwelfths = thirteenthMap && thirteenthMap.size > 0;

    if (hasTwelfths && employees.length > 0) {
      // Section header
      doc.rect(margin, y, contentW, 22).fill('#F1F5F9');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(primary)
        .text('13TH MONTH REFERENCE', margin + 8, y + 7);
      y += 22;

      for (const emp of employees) {
        const amt = thirteenthMap!.get(emp.id) ?? 0;
        const name = `${emp.lastName}, ${emp.firstName}`;
        doc.font('Helvetica').fontSize(9.5).fillColor(dark)
          .text(name, labelX, y + 4, { width: contentW - 170 })
          .text(fmt(amt), amtX, y + 4, { width: amtWidth, align: 'right' });
        y += 20;
        doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(lineColor).lineWidth(0.2).stroke();
      }
      y += 16;
    }

    // ── Signatories ───────────────────────────────────────────────────────────
    // Ensure signatories fit on the page; add page if needed
    const sigBlockH = 80;
    if (y + sigBlockH > pageH - 60) {
      doc.addPage();
      y = 50;
    }

    y += 10;
    doc.moveTo(margin, y).lineTo(pageW - margin, y).strokeColor(lineColor).lineWidth(1).stroke();
    y += 20;

    const sigColW  = contentW / 3;
    const sigLabels = ['Prepared by:', 'Approved by:', 'Received by:'];

    for (let i = 0; i < 3; i++) {
      const sx = margin + i * sigColW;
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(sigLabels[i], sx, y);
    }

    y += 30;

    // Signature line + name space for each
    for (let i = 0; i < 3; i++) {
      const sx = margin + i * sigColW;
      const lineEndX = sx + sigColW - 20;
      doc.moveTo(sx, y).lineTo(lineEndX, y).strokeColor(dark).lineWidth(0.75).stroke();
    }

    y += 6;

    // Name / title placeholders
    const clientSignatoryName  = billing.client?.clientSignatoryName ?? '';
    const clientSignatoryTitle = billing.client?.clientSignatoryTitle ?? '';
    const companySignatory     = company?.companyName ?? companyName;

    const sigNames = [companySignatory, companySignatory, clientSignatoryName || billing.client?.name];
    const sigTitles = ['Prepared by', 'Authorized Signatory', clientSignatoryTitle || 'Client Representative'];

    for (let i = 0; i < 3; i++) {
      const sx = margin + i * sigColW;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(dark).text(sigNames[i], sx, y, { width: sigColW - 20 });
      doc.font('Helvetica').fontSize(8).fillColor(muted).text(sigTitles[i], sx, y + 12, { width: sigColW - 20 });
    }

    doc.end();
  });
}
