import { getServiceState } from "../utils/serviceControls.js";

/**
 * Blocks a route while its service is switched off.
 *
 * HTTP 423 (not 503) on purpose: the app treats 5xx as "the server may have
 * processed this", which would wrongly tell members to check their history.
 * Nothing was processed here: the request is stopped before it starts.
 *
 * If the lock check itself fails, the request goes through (fail open).
 */
export const requireService = (key) => async (req, res, next) => {
  let state;
  try {
    state = await getServiceState(key);
  } catch {
    return next();
  }

  if (state.available) return next();

  return res.status(423).json({
    code: "SERVICE_UNAVAILABLE",
    service: key,
    message: state.message,
  });
};
