// Philippine statutory deduction computations — TRAIN Law (2024+)

/** SSS employee share: 4.5% of Monthly Salary Credit (₱5K–₱35K) */
export function computeSSS(basicSalary: number): number {
  const msc = Math.min(Math.max(basicSalary, 5000), 35000);
  return Math.round(msc * 0.045);
}

/** PhilHealth employee share: 2.5% of basic (min ₱500, max ₱2,500) */
export function computePhilHealth(basicSalary: number): number {
  return Math.round(Math.min(Math.max(basicSalary * 0.025, 500), 2500));
}

/** Pag-IBIG employee share: 2% of salary (max ₱200/month) */
export function computePagIBIG(basicSalary: number): number {
  if (basicSalary < 1500) return Math.round(basicSalary * 0.01);
  return Math.min(Math.round(basicSalary * 0.02), 200);
}

/** BIR monthly withholding tax — TRAIN Law graduated brackets */
export function computeWithholdingTax(taxableIncome: number): number {
  if (taxableIncome <= 20833) return 0;
  if (taxableIncome <= 33332) return Math.round((taxableIncome - 20833) * 0.20);
  if (taxableIncome <= 66666) return Math.round(2500 + (taxableIncome - 33332) * 0.25);
  if (taxableIncome <= 166666) return Math.round(10833 + (taxableIncome - 66666) * 0.30);
  if (taxableIncome <= 666666) return Math.round(40833 + (taxableIncome - 166666) * 0.32);
  return Math.round(200833 + (taxableIncome - 666666) * 0.35);
}

export interface PayrollComputation {
  basicSalary: number;
  grossPay: number;
  sssContrib: number;
  philhealthContrib: number;
  pagibigContrib: number;
  taxableIncome: number;
  withholdingTax: number;
  totalDeductions: number;
  netPay: number;
}

export function computePayroll(
  basicSalary: number,
  options: { allowances?: number; overtimePay?: number } = {}
): PayrollComputation {
  const allowances = options.allowances ?? 0;
  const overtimePay = options.overtimePay ?? 0;
  const grossPay = basicSalary + allowances + overtimePay;

  const sssContrib = computeSSS(basicSalary);
  const philhealthContrib = computePhilHealth(basicSalary);
  const pagibigContrib = computePagIBIG(basicSalary);

  const taxableIncome = grossPay - sssContrib - philhealthContrib - pagibigContrib;
  const withholdingTax = computeWithholdingTax(taxableIncome);

  const totalDeductions = sssContrib + philhealthContrib + pagibigContrib + withholdingTax;
  const netPay = grossPay - totalDeductions;

  return {
    basicSalary,
    grossPay,
    sssContrib,
    philhealthContrib,
    pagibigContrib,
    taxableIncome,
    withholdingTax,
    totalDeductions,
    netPay,
  };
}
