import LegalPage from "./LegalPage";

// DRAFT: have a Nigerian lawyer review before publishing. Items in [BRACKETS]
// are placeholders the cooperative must fill in.
const sections = [
  {
    h: "Who we are",
    p: [
      "Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited (“the Cooperative”, “we”) operates this website and the Exclusive Cooperative mobile app. We are the data controller for the personal data described here.",
      "Contact: exclusivecooperative@gmail.com, Oshodi/Isolo, Lagos. Registration number: [REGISTRATION NUMBER].",
    ],
  },
  {
    h: "Information we collect",
    p: ["When you register and use our services we collect:"],
    ul: [
      "Account details: name, email address, phone number, password (stored hashed).",
      "Membership details: date of birth, gender, address, state and LGA, occupation, next of kin, passport photograph and signature.",
      "Identity verification (KYC): BVN/NIN-related details and a selfie or liveness check, processed by our verification partner Dojah.",
      "Financial information: savings, top-ups, withdrawals, loan applications, repayments and dividends. Card payments are processed by Paystack; we do not store your card number.",
      "Device and usage information: push notification token, and security logs such as sign-in times.",
    ],
  },
  {
    h: "How we use it",
    p: [
      "To create and manage your membership and account; verify your identity; process savings, loans, repayments and dividends; send payment, loan and security notifications; prevent fraud; keep the records the law requires; and respond to your requests.",
      "We do not sell your personal data and do not use it for third-party advertising.",
    ],
  },
  {
    h: "Who we share it with",
    ul: [
      "Paystack, to process payments.",
      "Dojah, to verify your identity.",
      "Google Firebase, to deliver push notifications.",
      "Our hosting and database providers, who process data on our behalf.",
      "Regulators, law enforcement or the courts where the law requires it.",
    ],
    p: ["These providers may only use your data to provide their service to us."],
  },
  {
    h: "Camera, microphone and photos",
    p: [
      "The camera (and, where the verification provider requires it, the microphone) is used only during the identity-verification step. Photos are only read when you choose a picture to upload. We do not access your contacts or location.",
    ],
  },
  {
    h: "How long we keep it",
    p: [
      "We keep your data while your membership is active. After you delete your account we remove your personal profile, but we must keep financial and accounting records (savings, loans, repayments, payment references) and verification records for [RETENTION PERIOD, e.g. 6 years] to meet cooperative, tax and anti-money-laundering obligations. Those records are not used for any other purpose.",
    ],
  },
  {
    h: "Your rights",
    p: [
      "Under the Nigeria Data Protection Act 2023 you may ask to access, correct or delete your data, object to processing, or withdraw consent. To delete your account use Profile → Delete account in the app, or the page at /delete-account on this website. You may also complain to the Nigeria Data Protection Commission.",
    ],
  },
  {
    h: "Security",
    p: [
      "Data is sent over encrypted connections and passwords are stored hashed. No system is perfectly secure; tell us immediately if you suspect unauthorised access to your account.",
    ],
  },
  {
    h: "Children",
    p: ["Our services are for adults aged 18 and over. We do not knowingly collect data from children."],
  },
  {
    h: "Changes",
    p: ["We may update this policy. The date below shows the latest version. Last updated: [DATE]."],
  },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="How Exclusive Cooperative collects, uses and protects your personal data"
      sections={sections}
    />
  );
}
