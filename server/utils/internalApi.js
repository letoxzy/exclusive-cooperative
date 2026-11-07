import jwt from "jsonwebtoken";

/**
 * Calls one of THIS server's own API routes on behalf of a member (used by
 * USSD), so USSD follows exactly the same rules, limits and checks as the
 * mobile app instead of re-implementing them.
 *
 * - A short-lived (2 minute) login token is minted for the call and never
 *   stored or logged.
 * - The call goes to the local server (127.0.0.1), through the normal
 *   middleware (auth, approved-member check, idempotency, ...).
 * - Never throws. Returns { ok, status, data, uncertain }.
 *   `uncertain` is true when the outcome of a request is not known (timeout,
 *   dropped connection, 502/503/504), the same rule the mobile app uses before
 *   telling a member "check before you try again".
 */

const TIMEOUT_MS = 12000;

export async function callInternal(
  userId,
  method,
  path,
  { body, idempotencyKey, timeoutMs = TIMEOUT_MS } = {}
) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return { ok: false, status: 0, data: null, uncertain: false };
  }

  const headers = {
    Authorization: `Bearer ${jwt.sign({ id: String(userId) }, secret, { expiresIn: "2m" })}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      uncertain: [502, 503, 504].includes(response.status),
    };
  } catch {
    // Timeout or connection problem: the request may or may not have arrived.
    return { ok: false, status: 0, data: null, uncertain: true };
  } finally {
    clearTimeout(timer);
  }
}
