import LegalPage from "./LegalPage";

// DRAFT: have a Nigerian lawyer review before publishing. Check every figure
// against your bye-laws. Items in [BRACKETS] are placeholders.
const sections = [
  {
    h: "About these terms",
    p: [
      "These terms apply when you use the Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited website and mobile app. By creating an account you agree to them. Membership is also governed by the Cooperative’s bye-laws.",
    ],
  },
  {
    h: "Your account",
    p: [
      "You must be 18 or over and give true information. Keep your password and PIN private; you are responsible for activity on your account. Tell us immediately if you suspect misuse.",
    ],
  },
  {
    h: "Savings and withdrawals",
    p: [
      "Savings are credited after payment is confirmed. Withdrawals are reviewed and approved by the cooperative office and are subject to the bye-laws and any notice periods.",
    ],
  },
  {
    h: "Loans",
    p: [
      "Loans are provided by the Cooperative to its members only, subject to eligibility, identity verification and approval. The interest rate, period and total repayable are shown before you apply and confirmed on approval.",
      "Late repayment: if an instalment is not paid by its due date, 2% of the outstanding balance is added, and a further 2% for every additional 7 days it remains unpaid. This is separate from the loan interest.",
      "Repayments are made through the app by card or bank payment via Paystack and are applied to charges, interest and principal as set out in the bye-laws. Overpayments are refunded.",
    ],
  },
  {
    h: "Dividends",
    p: ["Dividends are declared by the Cooperative from its earnings and are not guaranteed."],
  },
  {
    h: "Payments",
    p: [
      "Card and bank payments are processed by Paystack. Provider fees, where any apply, are shown before you pay.",
    ],
  },
  {
    h: "Closing your account",
    p: [
      "You may delete your account at any time (see /delete-account). Accounts with savings, an open loan or pending items must first be settled with the office. We keep the records the law requires, as described in the Privacy Policy.",
    ],
  },
  {
    h: "Misuse",
    p: ["We may suspend or close accounts used for fraud, false information or unlawful activity."],
  },
  {
    h: "Liability",
    p: [
      "We provide the app on an “as available” basis and are not liable for losses outside our reasonable control, such as network or payment-provider outages. Nothing here limits rights you have under Nigerian law.",
    ],
  },
  {
    h: "Contact",
    p: ["exclusivecooperative@gmail.com, Oshodi/Isolo, Lagos. Governing law: Nigeria. Last updated: [DATE]."],
  },
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="The rules for using Exclusive Cooperative’s website and app"
      sections={sections}
    />
  );
}
