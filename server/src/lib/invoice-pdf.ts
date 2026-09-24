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

export async function generateInvoicePDF(billing: any, company?: CompanyInfo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const invoiceNo = billing.id.slice(-8).toUpperCase();
    const primary = '#2563EB';
    const muted = '#6B7280';
    const dark = '#111827';

    const companyName = company?.companyName || 'HRConnect';
    const companyAddress = company?.address || '';
    const companyPhone = company?.contactNumber || '';

    // Try to load logo from disk — logoUrl is stored as a full URL, extract just the filename
    let logoBuffer: Buffer | null = null;
    if (company?.logoUrl) {
      try {
        const filename = path.basename(company.logoUrl); // e.g. 'company-logo.png'
        const uploadsBase = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
        const logoPath = path.join(uploadsBase, 'logos', filename);
        if (fs.existsSync(logoPath)) {
          logoBuffer = fs.readFileSync(logoPath);
        }
      } catch {
        // Logo load failure is non-fatal
      }
    }

    // ── Header bar ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 6).fill(primary);

    // Logo + Company name (left) | INVOICE label (right)
    const logoSize = 56;
    const textX = logoBuffer ? 50 + logoSize + 12 : 50;

    if (logoBuffer) {
      doc.image(logoBuffer, 50, 22, { width: logoSize, height: logoSize });
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor(dark).text(companyName, textX, 40);
    let companySubY = 66;
    if (companyAddress) {
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(companyAddress, textX, companySubY);
      companySubY += 13;
    }
    if (companyPhone) {
      doc.font('Helvetica').fontSize(9).fillColor(muted).text(companyPhone, textX, companySubY);
      companySubY += 13;
    }
    if (!companyAddress && !companyPhone) {
      doc.font('Helvetica').fontSize(11).fillColor(muted).text('HR & Staffing Services', textX, 68);
    }

    doc.font('Helvetica-Bold').fontSize(28).fillColor(primary).text('INVOICE', 0, 40, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(muted);
    doc.text(`#${invoiceNo}`, 0, 75, { align: 'right' });
    doc.text(`Date: ${fmtDate(billing.billingDate)}`, 0, 90, { align: 'right' });
    if (billing.dueDate) {
      doc.text(`Due: ${fmtDate(billing.dueDate)}`, 0, 105, { align: 'right' });
    }

    // ── Bill To ──────────────────────────────────────────────────────────────────
    doc.y = 130;
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#E5E7EB').lineWidth(1).stroke();
    doc.y += 16;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('BILL TO', 50, doc.y);
    doc.y += 14;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(dark).text(billing.client.name, 50, doc.y);
    doc.y += 18;
    doc.font('Helvetica').fontSize(10).fillColor(muted);
    if (billing.client.address) { doc.text(billing.client.address, 50, doc.y); doc.y += 14; }
    if (billing.client.contactName) { doc.text(billing.client.contactName, 50, doc.y); doc.y += 14; }
    if (billing.client.contactEmail) { doc.text(billing.client.contactEmail, 50, doc.y); doc.y += 14; }
    if (billing.client.contactPhone) { doc.text(billing.client.contactPhone, 50, doc.y); doc.y += 14; }

    // ── Status badge ─────────────────────────────────────────────────────────────
    const badgeColor = billing.status === 'PAID' ? '#16A34A' : '#D97706';
    const badgeX = doc.page.width - 130;
    const badgeY = 150;
    doc.roundedRect(badgeX, badgeY, 80, 24, 4).fill(badgeColor);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#fff').text(billing.status, badgeX, badgeY + 7, { width: 80, align: 'center' });

    // ── Line items table ──────────────────────────────────────────────────────────
    const tableTop = Math.max(doc.y + 24, 280);
    const col1 = 50, col2 = 300, col3 = 400, rightEdge = doc.page.width - 50;

    // Table header
    doc.rect(50, tableTop, rightEdge - 50, 28).fill('#F3F4F6');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted);
    doc.text('DESCRIPTION / RESOURCE', col1 + 8, tableTop + 10);
    doc.text('POSITION', col2, tableTop + 10);
    doc.text('AMOUNT', col3, tableTop + 10, { width: rightEdge - col3, align: 'right' });

    let rowY = tableTop + 28;
    const employees = billing.client?.employees ?? [];

    if (employees.length > 0) {
      for (const emp of employees) {
        const name = `${emp.firstName} ${emp.lastName}`;
        const amount = emp.resourceCost ?? 0;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text(name, col1 + 8, rowY + 8);
        doc.font('Helvetica').fontSize(9).fillColor(muted).text(emp.position ?? '', col2, rowY + 8);
        if (amount > 0) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text(fmt(amount), col3, rowY + 8, { width: rightEdge - col3, align: 'right' });
        } else {
          doc.font('Helvetica').fontSize(9).fillColor(muted).text('—', col3, rowY + 8, { width: rightEdge - col3, align: 'right' });
        }
        rowY += 30;
        doc.moveTo(50, rowY).lineTo(rightEdge, rowY).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
      }
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(dark).text('Staffing services', col1 + 8, rowY + 8);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text(fmt(billing.amount), col3, rowY + 8, { width: rightEdge - col3, align: 'right' });
      rowY += 30;
      doc.moveTo(50, rowY).lineTo(rightEdge, rowY).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    }

    // ── Additional charges (line items) ──────────────────────────────────────────
    const lineItems: { label: string; amount: number }[] = (billing.lineItems as any) ?? [];
    if (lineItems.length > 0) {
      doc.font('Helvetica').fontSize(9).fillColor(muted).text('ADDITIONAL CHARGES', col1 + 8, rowY + 6);
      rowY += 24;
      for (const li of lineItems) {
        doc.font('Helvetica').fontSize(10).fillColor(dark).text(li.label, col1 + 8, rowY + 8);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text(fmt(li.amount), col3, rowY + 8, { width: rightEdge - col3, align: 'right' });
        rowY += 30;
        doc.moveTo(50, rowY).lineTo(rightEdge, rowY).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
      }
    }

    // ── Subtotals & fee breakdown ─────────────────────────────────────────────────
    rowY += 8;

    // Compute breakdown from employee resource costs + line items
    const empTotal = employees.reduce((s: number, e: any) => s + (e.resourceCost ?? 0), 0);
    const liTotal = lineItems.reduce((s: number, li: { label: string; amount: number }) => s + li.amount, 0);
    const grossSubtotal = empTotal + liTotal;
    const clientAdminFeeRate: number | null = billing.client?.adminFeeRate ?? null;
    const adminFeeAmount = clientAdminFeeRate ? grossSubtotal * clientAdminFeeRate / 100 : 0;
    const afterAdminFee = grossSubtotal + adminFeeAmount;
    const clientIsVatable: boolean = !!billing.client?.isVatable;
    const vatAmount = clientIsVatable ? afterAdminFee * 0.12 : 0;
    const grandTotal = afterAdminFee + vatAmount;

    const subtotalLabelX = col3 - 60;
    const subtotalAmtWidth = rightEdge - col3 - 8;

    // Show subtotal line only when there are fee additions
    if (adminFeeAmount > 0 || vatAmount > 0) {
      doc.font('Helvetica').fontSize(10).fillColor(muted)
        .text('Subtotal', subtotalLabelX, rowY, { width: 60, align: 'right' })
        .font('Helvetica').fillColor(dark).text(fmt(grossSubtotal), col3, rowY, { width: subtotalAmtWidth, align: 'right' });
      rowY += 18;
    }

    if (adminFeeAmount > 0) {
      doc.font('Helvetica').fontSize(10).fillColor(muted)
        .text(`Admin Fee (${clientAdminFeeRate}%)`, subtotalLabelX - 60, rowY, { width: 120, align: 'right' })
        .font('Helvetica').fillColor(dark).text(fmt(adminFeeAmount), col3, rowY, { width: subtotalAmtWidth, align: 'right' });
      rowY += 18;
    }

    if (vatAmount > 0) {
      doc.font('Helvetica').fontSize(10).fillColor(muted)
        .text('VAT (12%)', subtotalLabelX, rowY, { width: 60, align: 'right' })
        .font('Helvetica-Bold').fillColor('#0369A1').text(fmt(vatAmount), col3, rowY, { width: subtotalAmtWidth, align: 'right' });
      rowY += 18;
    }

    rowY += 4;

    // ── Total row ─────────────────────────────────────────────────────────────────
    doc.rect(col3 - 10, rowY, rightEdge - col3 + 10, 36).fill(primary);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff').text('TOTAL', col3, rowY + 12, { width: rightEdge - col3 - 8, align: 'right' });
    rowY += 36;
    doc.rect(col3 - 10, rowY, rightEdge - col3 + 10, 36).fill('#1D4ED8');
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#fff').text(fmt(grandTotal), col3, rowY + 11, { width: rightEdge - col3 - 8, align: 'right' });
    rowY += 50;

    // ── Payment section ───────────────────────────────────────────────────────────
    const bankName = process.env.BANK_NAME;
    const bankAccountName = process.env.BANK_ACCOUNT_NAME;
    const bankAccountNumber = process.env.BANK_ACCOUNT_NUMBER;
    const hasBankDetails = !!(bankName || bankAccountName || bankAccountNumber);

    if (billing.paymentLinkUrl || hasBankDetails) {
      // Section header bar
      doc.rect(50, rowY, doc.page.width - 100, 4).fill(primary);
      rowY += 12;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text('PAYMENT INSTRUCTIONS', 50, rowY);
      rowY += 18;
    }

    // Online payment link (PayMongo)
    if (billing.paymentLinkUrl) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('Online Payment', 50, rowY);
      rowY += 12;
      doc.font('Helvetica').fontSize(10).fillColor(primary)
        .text(billing.paymentLinkUrl, 50, rowY, { link: billing.paymentLinkUrl, underline: true });
      rowY += 22;
    }

    // Bank transfer details (shown alongside PayMongo link when both are set)
    if (hasBankDetails) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('Bank Transfer / Deposit', 50, rowY);
      rowY += 14;
      if (bankName) {
        doc.font('Helvetica').fontSize(10).fillColor(dark)
          .text('Bank:', 50, rowY)
          .font('Helvetica-Bold').text(bankName, 110, rowY);
        rowY += 14;
      }
      if (bankAccountName) {
        doc.font('Helvetica').fontSize(10).fillColor(dark)
          .text('Account Name:', 50, rowY)
          .font('Helvetica-Bold').text(bankAccountName, 150, rowY);
        rowY += 14;
      }
      if (bankAccountNumber) {
        doc.font('Helvetica').fontSize(10).fillColor(dark)
          .text('Account Number:', 50, rowY)
          .font('Helvetica-Bold').fontSize(12).fillColor(primary).text(bankAccountNumber, 165, rowY);
        rowY += 14;
      }
      rowY += 12;
    }

    if (!billing.paymentLinkUrl && !hasBankDetails) {
      // Minimal fallback — neither PayMongo nor bank env vars configured
      doc.font('Helvetica').fontSize(10).fillColor(muted)
        .text('To arrange payment, please reply to the invoice email or contact us directly.', 50, rowY);
      rowY += 24;
    }

    // ── Notes ─────────────────────────────────────────────────────────────────────
    if (billing.notes) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(dark).text('Notes:', 50, rowY);
      doc.font('Helvetica').fontSize(10).fillColor(muted).text(billing.notes, 50, rowY + 14);
      rowY += 40;
    }

    // ── Footer ────────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 16;
    doc.moveTo(50, footerY - 10).lineTo(doc.page.width - 50, footerY - 10).strokeColor('#E5E7EB').lineWidth(1).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(muted)
      .text(`Generated by ${companyName} · Thank you for your business`, 0, footerY, { align: 'center' });

    doc.end();
  });
}
