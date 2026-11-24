const idOf = (value) => (value == null ? null : String(value));
const isManualKey = (ref) => String(ref || "").startsWith("manual:");

const cleanNote = (note) =>
  String(note || "")
    .replace("Manual contribution recorded by the office: ", "")
    .replace("Manual contribution recorded by the office", "")
    .trim();

export function buildTransactionHistory({
  savings = [],
  repayments = [],
  loans = [],
  withdrawals = [],
  dividends = [],
}) {
  const items = [
    // SAVINGS
    ...savings.map((t) => {
      const reversed = Boolean(t.reversedAt);
      const status = reversed ? "reversed" : t.status;
      const manual = t.method === "manual";
      const paidOnline = t.method === "paystack";
      return {
        id: `savings-${t._id}`,
        type: "Savings Deposit",
        description: "Savings top-up",
        amount: Number(t.amount || 0),
        status,
        direction: "credit",
        // The internal duplicate-proof key of an office entry is not a reference a member needs.
        reference: isManualKey(t.reference) ? null : t.reference || null,
        date: t.createdAt,

        category: "savings",
        method: t.method || null,
        transactionId: idOf(t._id),
        receipt: paidOnline && status === "approved" && t.reference ? "paystack" : null,
        requestedAt: t.createdAt,
        completedAt: status === "approved" ? t.createdAt : null,
        note: manual ? cleanNote(t.note) : String(t.note || "").trim(),
        failureReason: reversed
          ? String(t.reversalReason || "").trim()
          : String(t.rejectionReason || t.reviewNote || "").trim(),
        recordedByOffice: t.source === "manual-entry",
      };
    }),

    // LOAN REPAYMENTS
    ...repayments.map((r) => ({
      id: `repayment-${r._id}`,
      type: "Loan Repayment",
      description:
        r.method === "paystack" ? "Loan repayment (Paystack)" : "Loan repayment confirmed",
      amount: Number(r.amount || 0),
      status: r.status,
      direction: "debit",
      reference: r.reference || r._id,
      date: r.approvedAt || r.updatedAt || r.createdAt,

      category: "loan",
      method: r.method || null,
      transactionId: idOf(r._id),
      // Receipts exist for online savings payments and paid withdrawals only.
      receipt: null,
      requestedAt: r.createdAt,
      completedAt: r.status === "approved" ? r.approvedAt || r.updatedAt || r.createdAt : null,
      note: String(r.note || "").trim(),
      failureReason: String(r.rejectionReason || r.reviewNote || "").trim(),
      loanId: idOf(r.loan),
    })),

    // LOAN DISBURSEMENTS
    ...loans.map((loan) => ({
      id: `loan-${loan._id}`,
      type: "Loan Disbursement",
      description: `${loan.loanType || "Loan"} loan disbursed (not savings)`,
      amount: Number(loan.amount || 0),
      status: "approved",
      direction: "credit",
      reference: loan._id,
      date: loan.disbursedDate || loan.createdAt,

      category: "loan",
      method: null,
      transactionId: idOf(loan._id),
      receipt: null,
      requestedAt: loan.applicationDate || loan.createdAt,
      completedAt: loan.disbursedDate || loan.createdAt,
      note: "",
      failureReason: "",
      loanId: idOf(loan._id),
    })),

    // WITHDRAWALS
    ...withdrawals.map((w) => ({
      id: `withdrawal-${w._id}`,
      type: "Withdrawal",
      description: `${w.bankName} ····${w.accountNumberLast4}`,
      amount: Number(w.amount || 0),
      status: w.status,
      direction: "debit",
      reference: w.reference,
      date: w.paidAt || w.createdAt,

      category: "withdrawal",
      method: null,
      transactionId: idOf(w._id),
      // The receipt route needs the plain id, not the "withdrawal-" list id.
      withdrawalId: idOf(w._id),
      receipt: w.status === "success" ? "withdrawal" : null,
      requestedAt: w.createdAt,
      completedAt: w.status === "success" ? w.paidAt || w.updatedAt || w.createdAt : null,
      note: "",
      failureReason: String(w.failureReason || "").trim(),
      source: w.source || "savings",
      bankName: w.bankName || "",
      accountName: w.accountName || "",
      accountNumberLast4: w.accountNumberLast4 || "",
      fee: Number(w.administrativeFee || 0),
      totalDeduction: Number(w.totalDeduction || w.amount || 0),
    })),

    // DIVIDENDS
    ...dividends.map((entry) => ({
      id: `dividend-${entry._id}`,
      type: "Dividend",
      description: "Dividend paid",
      amount: Number(entry.dividendAmount || 0),
      status: entry.status,
      direction: "credit",
      reference: entry._id,
      date: entry.paidDate || entry.createdAt,

      category: "dividend",
      method: null,
      transactionId: idOf(entry._id),
      receipt: null,
      requestedAt: entry.createdAt,
      completedAt: entry.paidDate || entry.createdAt,
      note: "",
      failureReason: "",
    })),
  ];

  return items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}
