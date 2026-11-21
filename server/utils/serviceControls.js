import ServiceControl from "../models/ServiceControl.js";

/**
 * Services an administrator can switch off (for example when Paystack or the
 * BVN provider has a problem). Add a line here to make a new service
 * switchable; the admin page, the website and the app pick it up from the API.
 */
export const SERVICE_CATALOG = [
  {
    key: "payments",
    label: "Online payments (Paystack)",
    description: "Savings top-ups and loan repayments paid online, in the app, on the website and by USSD.",
  },
  {
    key: "withdrawals",
    label: "Withdrawals",
    description: "Bank account checks and withdrawal requests, in the app, on the website and by USSD.",
  },
  {
    key: "bvn_verification",
    label: "BVN / identity verification",
    description: "Starting a new BVN or identity check for loan eligibility.",
  },
  {
    key: "loan_applications",
    label: "Loan applications",
    description: "New loan requests, in the app, on the website and by USSD.",
  },
  {
    key: "membership_applications",
    label: "Membership applications",
    description: "Submitting a new membership application.",
  },
  {
    key: "registrations",
    label: "New sign-ups",
    description: "Creating a new account.",
  },
];

const CATALOG_BY_KEY = new Map(SERVICE_CATALOG.map((s) => [s.key, s]));
export const isKnownService = (key) => CATALOG_BY_KEY.has(key);

export const defaultMessage = (key) => {
  const label = CATALOG_BY_KEY.get(key)?.label || "This service";
  return `${label} is not available at the moment. Please try again later.`;
};

// Re-read from the database at most every few seconds, so a flip takes effect
// almost immediately without a database call on every request.
const CACHE_MS = 5000;
let cache = { at: 0, docs: new Map() };

async function load(force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.docs;
  try {
    const docs = await ServiceControl.find().lean();
    cache = { at: Date.now(), docs: new Map(docs.map((d) => [d.key, d])) };
  } catch (err) {
    // If the lookup fails, keep the last known state. Never lock everyone out
    // because of a database hiccup.
    console.error("Service controls load error:", err.message);
    cache.at = Date.now();
  }
  return cache.docs;
}

export const invalidateServiceCache = () => {
  cache.at = 0;
};

/** { available, message } for one service. Unknown or unset services are available. */
export async function getServiceState(key, { fresh = false } = {}) {
  const docs = await load(fresh);
  const doc = docs.get(key);
  const available = doc ? doc.enabled !== false : true;
  return {
    key,
    available,
    message: available ? "" : doc?.message?.trim() || defaultMessage(key),
  };
}

/** Every catalog service with its current state, for the admin page and the public status call. */
export async function getAllServiceStates({ fresh = false } = {}) {
  const docs = await load(fresh);
  return SERVICE_CATALOG.map((service) => {
    const doc = docs.get(service.key);
    const available = doc ? doc.enabled !== false : true;
    return {
      key: service.key,
      label: service.label,
      description: service.description,
      available,
      customMessage: doc?.message || "",
      message: available ? "" : doc?.message?.trim() || defaultMessage(service.key),
      updatedAt: doc?.updatedAt || null,
      updatedByName: doc?.updatedByName || "",
    };
  });
}
