import crypto from "crypto";
import IdempotencyKey from "../models/IdempotencyKey.js";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;

function hashBody(body) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body ?? {}))
    .digest("hex");
}

/**
 * Makes a POST safe to retry.
 *
 * Mount AFTER `protect` so req.user exists:
 *   router.post("/", protect, requireApprovedMember, idempotent("withdrawals:create"), handler)
 *
 * Behaviour (only when the client sends an `Idempotency-Key` header):
 *  - first request          -> runs normally; the response is stored
 *  - same key, same body    -> replays the stored response (header Idempotent-Replay: true)
 *  - same key, still running-> 409, so two copies can never run at once
 *  - same key, other body   -> 422, the key was reused for a different request
 *  - handler answers 5xx    -> the key is released so the member can safely retry
 * Requests without the header behave exactly as before.
 */
export const idempotent = (scope) => async (req, res, next) => {
  const key = req.get("Idempotency-Key");
  if (!key) return next();

  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({ message: "Invalid Idempotency-Key." });
  }

  const filter = { user: req.user._id, scope, key };
  const requestHash = hashBody(req.body);

  try {
    await IdempotencyKey.create({ ...filter, requestHash });
  } catch (err) {
    if (err?.code !== 11000) {
      console.error("Idempotency store error:", err);
      return res.status(503).json({
        message: "Service temporarily unavailable. Please try again shortly.",
      });
    }

    const existing = await IdempotencyKey.findOne(filter);
    if (!existing) return next(); // expired between the two calls; just proceed

    if (existing.requestHash !== requestHash) {
      return res.status(422).json({
        message: "This request does not match your earlier one. Please start again.",
      });
    }

    if (existing.state === "completed") {
      res.set("Idempotent-Replay", "true");
      return res.status(existing.responseStatus).json(existing.responseBody);
    }

    const age = Date.now() - new Date(existing.createdAt).getTime();
    return res.status(409).json({
      code: "REQUEST_IN_PROGRESS",
      message:
        age > STALE_IN_PROGRESS_MS
          ? "We could not confirm your earlier request. Please check your transaction history before trying again."
          : "Your previous request is still being processed. Please wait a moment and check your history.",
    });
  }

  // Capture the answer the handler sends.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode || 200;
    const settle =
      status >= 500
        ? IdempotencyKey.deleteOne(filter) // nothing happened or it was rolled back
        : IdempotencyKey.updateOne(filter, {
            $set: { state: "completed", responseStatus: status, responseBody: body },
          });
    settle.catch((e) => console.error("Idempotency settle error:", e));
    return originalJson(body);
  };

  next();
};
