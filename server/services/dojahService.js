
/*
 * Dojah helpers
 *
 * - Fetches authoritative EasyOnboard verification results.
 * - Parses Dojah responses defensively.
 * - Compares verified identity information with cooperative records.
 *
 * Production is the default. Set DOJAH_BASE_URL to
 * https://sandbox.dojah.io only when intentionally testing.
 */

const DOJAH_BASE_URL = (
  process.env.DOJAH_BASE_URL || "https://api.dojah.io"
).replace(/\/+$/, "");

export function isSandbox() {
  return /sandbox/i.test(DOJAH_BASE_URL);
}

function getHeaders() {
  const appId = process.env.DOJAH_APP_ID;
  const secretKey = process.env.DOJAH_SECRET_KEY;

  if (!appId || !secretKey) {
    throw new Error("Dojah production credentials are not configured.");
  }

  return {
    AppId: appId,
    Authorization: secretKey,
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

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : {};

    if (!response.ok) {
      const error = new Error(
        data?.message ||
        data?.error ||
        `Dojah returned HTTP ${response.status}.`
      );

      error.status = response.status;
      error.providerData = data;
      throw error;
    }

    if (!data || typeof data !== "object") {
      throw new Error("Dojah returned an invalid verification response.");
    }

    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const error = new Error("Dojah took too long to respond.");
      error.status = 504;
      throw error;
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------------------------
   General helpers
---------------------------------------------------------------- */

const text = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

export const last4 = (value) => {
  const digits = text(value).replace(/\D/g, "");
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
  return [
    ...new Set(
      normaliseText(value)
        .split(/[^a-z]+/)
        .filter((token) => token.length >= 2)
    ),
  ];
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }

    edits++;
    if (edits > 1) return false;

    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }

  return edits + (a.length - i) + (b.length - j) <= 1;
}

function sameNamePart(a, b) {
  if (a === b) return true;

  return (
    Math.min(a.length, b.length) >= 5 &&
    editDistanceAtMostOne(a, b)
  );
}

export function namesMatch(a, b) {
  const first = nameTokens(a);
  const second = nameTokens(b);

  if (!first.length || !second.length) return false;

  const [small, large] =
    first.length <= second.length
      ? [first, second]
      : [second, first];

  const shared = small.filter((token) =>
    large.some((other) => sameNamePart(token, other))
  ).length;

  return shared === small.length && shared >= Math.min(2, small.length);
}

const pad = (n) => String(n).padStart(2, "0");

const isoDate = (y, m, d) =>
  `${y}-${pad(m)}-${pad(d)}`;

export function normaliseDate(value) {
  const raw = text(value);
  if (!raw) return "";

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);

  if (match) {
    return isoDate(match[1], match[2], match[3]);
  }

  // Nigerian date convention: DD-MM-YYYY.
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);

  if (match) {
    return isoDate(match[3], match[2], match[1]);
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) return "";

  return isoDate(
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate()
  );
}

const phoneKey = (value) =>
  text(value).replace(/\D/g, "").slice(-10);

/* ---------------------------------------------------------------
   Status helpers
---------------------------------------------------------------- */

const TRUE_WORDS = [
  "true",
  "success",
  "successful",
  "completed",
  "verified",
  "passed",
];

const FALSE_WORDS = [
  "false",
  "failed",
  "fail",
  "declined",
  "rejected",
];

const isTrue = (value) =>
  value === true || TRUE_WORDS.includes(text(value).toLowerCase());

const isFalse = (value) =>
  value === false || FALSE_WORDS.includes(text(value).toLowerCase());

function getStatus(block) {
  if (!block || typeof block !== "object") return "";

  return text(
    block.status ||
    block.verification_status ||
    block.verificationStatus
  ).toLowerCase();
}

function findPersonRecord(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;

  if (!Array.isArray(node)) {
    const hasFirst = node.first_name || node.firstName;
    const hasLast = node.last_name || node.lastName;

    if (hasFirst && hasLast) return node;

    if (node.full_name || node.fullname) return node;
  }

  for (const value of Object.values(node)) {
    const found = findPersonRecord(value, depth + 1);
    if (found) return found;
  }

  return null;
}

function pickPersonRecord(block) {
  if (!block || typeof block !== "object") return null;

  return (
    block.entity ||
    block.data?.entity ||
    findPersonRecord(block.data || block)
  );
}

function toImageDataUrl(value) {
  const raw = text(value);

  if (!raw) return "";

  if (raw.startsWith("data:image")) return raw;

  if (/^https?:\/\//i.test(raw)) return raw;

  return `data:image/jpeg;base64,${raw}`;
}

/* ---------------------------------------------------------------
   Parse Dojah verification response
---------------------------------------------------------------- */

export function parseVerification(raw) {
  let root = raw && typeof raw === "object" ? raw : {};

  if (
    root.entity &&
    typeof root.entity === "object" &&
    !root.verification_status &&
    !root.data
  ) {
    root = root.entity;
  }

  const checks =
    root.data && typeof root.data === "object"
      ? root.data
      : {};

  const status = text(
    root.verification_status ||
    root.verificationStatus ||
    root.status
  ).toLowerCase();

  // Government identity information.
  const governmentBlock = checks.government_data || {};
  const governmentData = governmentBlock.data || governmentBlock;

  const bvnBlock =
    governmentData.bvn ||
    governmentData.BVN ||
    null;

  const bvnEntity = pickPersonRecord(bvnBlock);

  const governmentEntity =
    bvnEntity ||
    pickPersonRecord(governmentBlock) ||
    findPersonRecord(governmentData);

  const bvnPassed =
    Boolean(governmentEntity) ||
    isTrue(getStatus(bvnBlock)) ||
    isTrue(getStatus(governmentBlock));

  const bvnFullName = governmentEntity
    ? [
        governmentEntity.first_name || governmentEntity.firstName,
        governmentEntity.middle_name || governmentEntity.middleName,
        governmentEntity.last_name || governmentEntity.lastName,
      ]
        .map(text)
        .filter(Boolean)
        .join(" ") ||
      text(governmentEntity.full_name || governmentEntity.fullname)
    : "";

  // Government ID document.
  const idBlock = checks.id || {};
  const idData =
    idBlock.data?.id_data ||
    idBlock.data ||
    {};

  const idFullName = [
    idData.first_name || idData.firstName,
    idData.middle_name || idData.middleName,
    idData.last_name || idData.lastName,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

  const idPassed = isTrue(getStatus(idBlock));

  // Selfie and liveness are deliberately kept separate.
  const selfieBlock = checks.selfie || {};
  const selfieData = selfieBlock.data || {};

  const selfieUrl = text(
    selfieData.selfie_url ||
    selfieData.image_url ||
    root.selfie_url
  );

  const livenessBlock =
    checks.liveness ||
    checks.face_auth ||
    checks.face ||
    {};

  const livenessPassed = isTrue(getStatus(livenessBlock));

  const selfieCaptured =
    Boolean(selfieUrl) ||
    isTrue(getStatus(selfieBlock));

  return {
    referenceId: text(root.reference_id),
    topLevelKeys: Object.keys(root).slice(0, 25),
    status,
    message: text(root.message),

    bvn: {
      passed: bvnPassed,
      number: text(
        governmentEntity?.bvn ||
        governmentEntity?.nin
      ),
      fullName: bvnFullName,
      dob: text(
        governmentEntity?.dob ||
        governmentEntity?.date_of_birth ||
        governmentEntity?.dateOfBirth
      ),
      gender: text(governmentEntity?.gender),
      phone: text(
        governmentEntity?.phone_number1 ||
        governmentEntity?.phone_number ||
        governmentEntity?.phoneNumber ||
        governmentEntity?.phone
      ),
      photo: toImageDataUrl(
        governmentEntity?.image ||
        governmentEntity?.photo
      ),
    },

    id: {
      passed: idPassed,
      fullName: idFullName,
      documentType: text(
        idData.document_type ||
        idData.documentType
      ),
      documentNumber: text(
        idData.document_number ||
        idData.documentNumber
      ),
      url: text(
        idBlock.data?.id_url ||
        root.id_url
      ),
      backUrl: text(root.back_url),
    },

    selfie: {
      passed: selfieCaptured,
      captured: selfieCaptured,
      url: selfieUrl,
    },

    liveness: {
      passed: livenessPassed,
    },

    location: {
      city: text(root.metadata?.ipinfo?.city),
      region: text(
        root.metadata?.ipinfo?.region_name ||
        root.metadata?.ipinfo?.region
      ),
      country: text(root.metadata?.ipinfo?.country),
    },

    reportUrl: text(root.verification_pdf),
    dashboardUrl: text(root.verification_url),
  };
}

/* ---------------------------------------------------------------
   Compare Dojah identity with cooperative record
---------------------------------------------------------------- */

export function compareIdentity(details, member) {
  const bvn = details?.bvn || {};
  const id = details?.id || {};

  const verifiedName = bvn.fullName || id.fullName;
  const nameMatched = verifiedName
    ? namesMatch(member?.fullName, verifiedName)
    : false;

  const verifiedDob = bvn.dob || "";

  const memberDob = normaliseDate(member?.dob);
  const identityDob = normaliseDate(verifiedDob);

  const dobMatched =
    memberDob && identityDob
      ? memberDob === identityDob
      : null;

  const memberPhone = phoneKey(member?.phone);
  const verifiedPhone = phoneKey(bvn.phone);

  const phoneMatched =
    memberPhone.length >= 7 && verifiedPhone.length >= 7
      ? memberPhone === verifiedPhone
      : null;

  const memberGender = normaliseText(member?.gender).charAt(0);
  const verifiedGender = normaliseText(bvn.gender).charAt(0);

  const genderMatched =
    memberGender && verifiedGender
      ? memberGender === verifiedGender
      : null;

  const idNameMatched = id.fullName
    ? namesMatch(member?.fullName, id.fullName)
    : null;

  return {
    nameMatched,
    dobMatched,
    phoneMatched,
    genderMatched,
    idNameMatched,

    autoMatched:
      nameMatched &&
      dobMatched !== false,
  };
}

/* ---------------------------------------------------------------
   Verification audit snapshot
---------------------------------------------------------------- */

export function buildSnapshot(
  details,
  comparison,
  { duplicateBvn = false } = {}
) {
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

    selfie: {
      captured: details.selfie.captured,
    },

    liveness: {
      passed: details.liveness.passed,
    },

    comparison,
  };
}

/* ---------------------------------------------------------------
   Safe response-shape diagnostic
---------------------------------------------------------------- */

export function describeShape(value, depth = 0) {
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return `[${value.length ? describeShape(value[0], depth + 1) : ""}]`;
  }

  if (typeof value === "boolean") return String(value);

  if (typeof value !== "object") {
    return typeof value === "string"
      ? "str"
      : typeof value;
  }

  if (depth >= 7) return "{…}";

  return `{${Object.entries(value)
    .slice(0, 20)
    .map(
      ([key, inner]) =>
        `${key}:${describeShape(inner, depth + 1)}`
    )
    .join(",")}}`;
}
