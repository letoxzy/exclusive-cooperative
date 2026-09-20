/*
  Dojah helpers
  -------------
  - getVerificationDetails(): fetches the authoritative result of an
    EasyOnboard verification from Dojah using its reference id.
  - parseVerification():      turns Dojah's nested response into a flat,
    predictable object (defensive: any field can be missing).
  - compareIdentity():        compares what Dojah returned with the member's
    cooperative record so the administrator can see what matches.

  Sandbox vs live is decided ONLY by DOJAH_BASE_URL:
    https://sandbox.dojah.io  -> sandbox (dummy identity data)
    https://api.dojah.io      -> live
*/

const DOJAH_BASE_URL = (
  process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io"
).replace(/\/$/, "");

export function isSandbox() {
  return /sandbox/i.test(DOJAH_BASE_URL);
}

function getHeaders() {
  if (!process.env.DOJAH_APP_ID || !process.env.DOJAH_SECRET_KEY) {
    throw new Error("Dojah credentials are not configured on the backend.");
  }

  return {
    AppId: process.env.DOJAH_APP_ID,
    Authorization: process.env.DOJAH_SECRET_KEY,
    Accept: "application/json",
  };
}

export async function getVerificationDetails(referenceId) {
  const value = String(referenceId || "").trim();
  if (!value) {
    throw new Error("A Dojah verification reference is required.");
  }

  const url = new URL(`${DOJAH_BASE_URL}/api/v1/kyc/verification`);
  url.searchParams.set("reference_id", value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        data?.message || data?.error || `Dojah returned HTTP ${response.status}.`
      );
      error.status = response.status;
      error.providerData = data;
      throw error;
    }

    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutError = new Error("Dojah took too long to respond.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------------------------
   Small helpers
---------------------------------------------------------------- */

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

export const last4 = (value) => {
  const digits = text(value).replace(/\s/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};

export const maskValue = (value) => {
  const tail = last4(value);
  return tail ? `••••${tail}` : "";
};

const normaliseText = (value) =>
  text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function nameTokens(value) {
  const tokens = normaliseText(value)
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);
  return [...new Set(tokens)];
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  return edits + (a.length - i) + (b.length - j) <= 1;
}

// "Mohammed" vs "Muhammed" should count as the same name part.
function sameNamePart(a, b) {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 5 && editDistanceAtMostOne(a, b);
}

/*
  Order-insensitive name comparison. Nigerian names are often written in a
  different order, or with/without a middle name, so we do not require an
  exact string match. The shorter name must be fully contained in the longer
  one, and at least two name parts must match (unless a name has only one).
*/
export function namesMatch(a, b) {
  const first = nameTokens(a);
  const second = nameTokens(b);
  if (!first.length || !second.length) return false;

  const [small, large] = first.length <= second.length ? [first, second] : [second, first];
  const shared = small.filter((token) => large.some((other) => sameNamePart(token, other))).length;

  return shared === small.length && shared >= Math.min(2, small.length);
}

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Returns YYYY-MM-DD, or "" when the value cannot be understood.
export function normaliseDate(value) {
  const raw = text(value);
  if (!raw) return "";

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return isoDate(match[1], match[2], match[3]);

  // Nigerian convention is day first: 20-05-1990 or 20/05/1990
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) return isoDate(match[3], match[2], match[1]);

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return isoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

const phoneKey = (value) => text(value).replace(/\D/g, "").slice(-10);

/* ---------------------------------------------------------------
   Parsing Dojah's "Get verification" response
---------------------------------------------------------------- */

function pickBvnEntity(bvnResult) {
  if (!bvnResult || typeof bvnResult !== "object") return null;
  if (bvnResult.entity && typeof bvnResult.entity === "object") return bvnResult.entity;
  if (bvnResult.data?.entity && typeof bvnResult.data.entity === "object") return bvnResult.data.entity;
  if (bvnResult.first_name || bvnResult.firstName) return bvnResult;
  return null;
}

function toImageDataUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  if (raw.startsWith("data:image")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  // Dojah returns the BVN photo as raw base64 (JPEG).
  return `data:image/jpeg;base64,${raw}`;
}

export function parseVerification(raw) {
  const root = raw && typeof raw === "object" ? raw : {};
  const checks = root.data && typeof root.data === "object" ? root.data : {};

  const status = text(root.verification_status || root.verificationStatus).toLowerCase();

  // ---- BVN (government data) ----
  const bvnResult = checks.government_data?.data?.bvn;
  const entity = pickBvnEntity(bvnResult);
  const bvnPassed = bvnResult?.status === true && !!entity;

  const bvnFullName = entity
    ? [
        entity.first_name || entity.firstName,
        entity.middle_name || entity.middleName,
        entity.last_name || entity.lastName,
      ]
        .map(text)
        .filter(Boolean)
        .join(" ")
    : "";

  // ---- ID document ----
  const idBlock = checks.id || {};
  const idData = idBlock.data?.id_data || {};
  const idFullName = [idData.first_name, idData.middle_name, idData.last_name]
    .map(text)
    .filter(Boolean)
    .join(" ");

  // ---- Selfie / liveness ----
  const selfieBlock = checks.selfie || {};

  return {
    referenceId: text(root.reference_id),
    status,
    message: text(root.message),

    bvn: {
      passed: bvnPassed,
      // Full BVN is only used server-side to detect one BVN on two accounts.
      number: text(entity?.bvn),
      fullName: bvnFullName,
      dob: text(entity?.dob || entity?.date_of_birth || entity?.dateOfBirth),
      gender: text(entity?.gender),
      phone: text(entity?.phone_number1 || entity?.phone_number || entity?.phoneNumber || entity?.phone),
      photo: toImageDataUrl(entity?.image || entity?.photo),
    },

    id: {
      passed: idBlock.status === true,
      fullName: idFullName,
      documentType: text(idData.document_type),
      documentNumber: text(idData.document_number),
      url: text(idBlock.data?.id_url || root.id_url),
      backUrl: text(root.back_url),
    },

    selfie: {
      passed: selfieBlock.status === true,
      url: text(selfieBlock.data?.selfie_url || root.selfie_url),
    },

    location: {
      city: text(root.metadata?.ipinfo?.city),
      region: text(root.metadata?.ipinfo?.region_name || root.metadata?.ipinfo?.region),
      country: text(root.metadata?.ipinfo?.country),
    },

    reportUrl: text(root.verification_pdf),
    dashboardUrl: text(root.verification_url),
  };
}

/* ---------------------------------------------------------------
   Comparing Dojah's data with the member's cooperative record
---------------------------------------------------------------- */

// `member` needs: fullName, dob, phone, gender (a Membership or the
// applicantDetails snapshot both work).
export function compareIdentity(details, member) {
  const bvn = details?.bvn || {};
  const id = details?.id || {};

  const nameMatched = bvn.fullName ? namesMatch(member?.fullName, bvn.fullName) : false;

  const memberDob = normaliseDate(member?.dob);
  const bvnDob = normaliseDate(bvn.dob);
  const dobMatched = memberDob && bvnDob ? memberDob === bvnDob : null;

  const memberPhone = phoneKey(member?.phone);
  const bvnPhone = phoneKey(bvn.phone);
  const phoneMatched = memberPhone.length >= 7 && bvnPhone.length >= 7 ? memberPhone === bvnPhone : null;

  const memberGender = normaliseText(member?.gender).charAt(0);
  const bvnGender = normaliseText(bvn.gender).charAt(0);
  const genderMatched = memberGender && bvnGender ? memberGender === bvnGender : null;

  const idNameMatched = id.fullName ? namesMatch(member?.fullName, id.fullName) : null;

  return {
    nameMatched,
    dobMatched,
    phoneMatched,
    genderMatched,
    idNameMatched,
    // The automatic verdict: the name must match and the date of birth must
    // not contradict. Phone / gender / ID name are shown to the admin as
    // extra evidence but do not decide this on their own.
    autoMatched: nameMatched && dobMatched !== false,
  };
}

// Compact, photo-free record saved on the application for audit purposes.
export function buildSnapshot(details, comparison, { duplicateBvn = false } = {}) {
  return {
    capturedAt: new Date(),
    sandbox: isSandbox(),
    duplicateBvn,
    bvn: {
      fullName: details.bvn.fullName,
      dob: details.bvn.dob,
      gender: details.bvn.gender,
      phoneLast4: last4(details.bvn.phone),
    },
    id: {
      fullName: details.id.fullName,
      documentType: details.id.documentType,
      documentLast4: last4(details.id.documentNumber),
    },
    comparison,
  };
}
