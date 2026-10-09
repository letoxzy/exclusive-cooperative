import mongoose from "mongoose";

/**
 * Runs `fn(session)` inside a MongoDB transaction so related writes (e.g. the
 * transaction record, the member balance and the ledger entry) commit or roll
 * back together.
 *
 * Transactions need a replica set (MongoDB Atlas always is one). On a
 * standalone local mongod they are unsupported; in that case we log once and
 * run `fn(null)` without a transaction so local development keeps working.
 * Set REQUIRE_DB_TRANSACTIONS=true in production to make that a hard error.
 */
let warned = false;

export async function runAtomic(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const unsupported =
      /Transaction numbers are only allowed|replica set|does not support transactions/i.test(
        String(err?.message || "")
      );
    if (unsupported && process.env.REQUIRE_DB_TRANSACTIONS !== "true") {
      if (!warned) {
        console.warn(
          "[atomic] MongoDB transactions unavailable (standalone server) - running without one."
        );
        warned = true;
      }
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
