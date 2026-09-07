// Philippine payroll computations (TRAIN Law) — mirrors server/src/lib/payroll.ts

export function computeSSS(basicSalary: number): number {
  const msc = Math.min(Math.max(basicSalary, 5000), 35000);
  return Math.round(msc * 0.045 * 100) / 100;
}

export function computePhilHealth(basicSalary: number): number {
  const contrib = Math.round(basicSalary * 0.025 * 100) / 100;
  return Math.min(Math.max(contrib, 500), 2500);
}

export function computePagIBIG(basicSalary: number): number {
  return Math.min(Math.round(basicSalary * 0.02 * 100) / 100, 200);
}

export function computeWithholdingTax(taxableIncome: number): number {
  // BIR monthly brackets (TRAIN Law 2023+)
  if (taxableIncome <= 20833) return 0;
  if (taxableIncome <= 33332) return (taxableIncome - 20833) * 0.15;
  if (taxableIncome <= 66666) return 1875 + (taxableIncome - 33333) * 0.2;
  if (taxableIncome <= 166666) return 8541.8 + (taxableIncome - 66667) * 0.25;
  if (taxableIncome <= 666666) return 33541.8 + (taxableIncome - 166667) * 0.3;
  return 183541.8 + (taxableIncome - 666667) * 0.35;
}

export interface PayrollComputation {
  basicSalary: number;
  daysWorked: number;
  overtimePay: number;
  allowances: number;
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
  options: { daysWorked?: number; workingDays?: number; overtimeHrs?: number; allowances?: number } = {}
): PayrollComputation {
  const { daysWorked = 22, workingDays = 22, overtimeHrs = 0, allowances = 0 } = options;
  const dailyRate = basicSalary / workingDays;
  const effectiveBasic = dailyRate * daysWorked;
  const hourlyRate = dailyRate / 8;
  const overtimePay = Math.round(overtimeHrs * hourlyRate * 1.25 * 100) / 100;
  const grossPay = Math.round((effectiveBasic + overtimePay + allowances) * 100) / 100;
  const sssContrib = computeSSS(basicSalary);
  const philhealthContrib = computePhilHealth(basicSalary);
  const pagibigContrib = computePagIBIG(basicSalary);
  const taxableIncome = grossPay - sssContrib - philhealthContrib - pagibigContrib;
  const withholdingTax = Math.round(computeWithholdingTax(taxableIncome) * 100) / 100;
  const totalDeductions = Math.round((sssContrib + philhealthContrib + pagibigContrib + withholdingTax) * 100) / 100;
  const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;
  return {
    basicSalary,
    daysWorked,
    overtimePay,
    allowances,
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

export function formatPHP(amount: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}
