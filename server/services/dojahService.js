const DOJAH_BASE_URL = (
  process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io"
).replace(/\/$/, "");

function getHeaders() {
  if (!process.env.DOJAH_APP_ID || !process.env.DOJAH_SECRET_KEY) {
    throw new Error("Dojah Sandbox credentials are not configured on the backend.");
  }

  return {
    AppId: process.env.DOJAH_APP_ID,
    Authorization: process.env.DOJAH_SECRET_KEY,
    Accept: "application/json",
  };
}

function normalise(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseEntity(data) {
  return data?.entity || data?.data?.entity || data?.data || null;
}

export async function lookupBVN(bvn) {
  const value = String(bvn || "").trim();
  if (!/^\d{11}$/.test(value)) {
    throw new Error("BVN must contain exactly 11 digits.");
  }

  const url = new URL(`${DOJAH_BASE_URL}/api/v1/kyc/bvn`);
  url.searchParams.set("bvn", value);

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
        data?.message || data?.error || `Dojah returned HTTP ${response.status}.`,
      );
      error.status = response.status;
      error.providerData = data;
      throw error;
    }

    return {
      raw: data,
      entity: parseEntity(data),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function compareBVNIdentity(entity, membership) {
  if (!entity) {
    return { matched: false, reason: "Dojah did not return identity data." };
  }

  const returnedName = [
    entity.first_name || entity.firstName,
    entity.middle_name || entity.middleName,
    entity.last_name || entity.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const memberName = membership?.fullName || "";
  const nameMatched = normalise(returnedName) === normalise(memberName);

  const returnedDob = entity.dob || entity.date_of_birth || entity.dateOfBirth || "";
  const memberDob = membership?.dob || "";
  const dobMatched = !returnedDob || !memberDob
    ? true
    : String(returnedDob).slice(0, 10) === String(memberDob).slice(0, 10);

  return {
    matched: nameMatched && dobMatched,
    nameMatched,
    dobMatched,
    returnedName,
    returnedDob,
  };
}
