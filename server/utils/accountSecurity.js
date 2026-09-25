import { createNotificationAndPush } from "./createNotification.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES_BY_LEVEL = {
  1: 10,
  2: 30,
};

export function getSecurityState(user) {
  const now = new Date();

  if (user.securityLockedPermanently) {
    return {
      locked: true,
      permanent: true,
      lockedUntil: null,
      level: Number(user.securityLockLevel || 2),
    };
  }

  if (user.securityLockedUntil && user.securityLockedUntil > now) {
    return {
      locked: true,
      permanent: false,
      lockedUntil: user.securityLockedUntil,
      level: Number(user.securityLockLevel || 1),
    };
  }

  // An expired temporary lock is no longer active. Keep the escalation
  // level so the next group of five failures advances to the next stage.
  if (user.securityLockedUntil && user.securityLockedUntil <= now) {
    user.securityLockedUntil = null;
  }

  return {
    locked: false,
    permanent: false,
    lockedUntil: null,
    level: Number(user.securityLockLevel || 0),
  };
}

export async function recordSecurityFailure(user) {
  const nextAttempts = Number(user.securityFailedAttempts || 0) + 1;
  user.securityFailedAttempts = nextAttempts;

  if (nextAttempts < MAX_FAILED_ATTEMPTS) {
    await user.save();
    return {
      locked: false,
      permanent: false,
      failedAttempts: nextAttempts,
      remainingAttempts: MAX_FAILED_ATTEMPTS - nextAttempts,
      lockedUntil: null,
      level: Number(user.securityLockLevel || 0),
    };
  }

  const currentLevel = Number(user.securityLockLevel || 0);

  if (currentLevel === 0) {
    user.securityLockLevel = 1;
    user.securityFailedAttempts = 0;
    user.securityLockedUntil = new Date(Date.now() + LOCK_MINUTES_BY_LEVEL[1] * 60 * 1000);
    await user.save();

    return {
      locked: true,
      permanent: false,
      failedAttempts: 0,
      remainingAttempts: 0,
      lockedUntil: user.securityLockedUntil,
      level: 1,
      lockMinutes: LOCK_MINUTES_BY_LEVEL[1],
    };
  }

  if (currentLevel === 1) {
    user.securityLockLevel = 2;
    user.securityFailedAttempts = 0;
    user.securityLockedUntil = new Date(Date.now() + LOCK_MINUTES_BY_LEVEL[2] * 60 * 1000);
    await user.save();

    return {
      locked: true,
      permanent: false,
      failedAttempts: 0,
      remainingAttempts: 0,
      lockedUntil: user.securityLockedUntil,
      level: 2,
      lockMinutes: LOCK_MINUTES_BY_LEVEL[2],
    };
  }

  user.securityFailedAttempts = 0;
  user.securityLockedUntil = null;
  user.securityLockedPermanently = true;
  user.securityLockedAt = new Date();
  user.securityLockReason = "Repeated failed authentication attempts";
  await user.save();

  return {
    locked: true,
    permanent: true,
    failedAttempts: 0,
    remainingAttempts: 0,
    lockedUntil: null,
    level: 2,
  };
}

export async function recordSecuritySuccess(user) {
  // Successful authentication clears the current five-attempt window, but
  // intentionally preserves the escalation level. An account that has
  // already reached its second temporary lock must still reach the admin
  // unlock stage if another five failures occur.
  if (Number(user.securityFailedAttempts || 0) !== 0 || user.securityLockedUntil) {
    user.securityFailedAttempts = 0;
    user.securityLockedUntil = null;
    await user.save();
  }
}

export async function notifyPermanentSecurityLock(user) {
  try {
    await createNotificationAndPush({
      user: user._id,
      type: "security",
      title: "Account Security Lock",
      message: "Your account has been locked after repeated failed PIN or password attempts. Please contact the cooperative so an administrator can unlock your account.",
    });
  } catch (error) {
    console.error("Permanent security lock notification failed:", error);
  }
}

export async function resetAccountSecurityLock(user) {
  user.securityFailedAttempts = 0;
  user.securityLockLevel = 0;
  user.securityLockedUntil = null;
  user.securityLockedPermanently = false;
  user.securityLockedAt = null;
  user.securityLockReason = null;
  await user.save();
}

export const SECURITY_POLICY = {
  maxAttempts: MAX_FAILED_ATTEMPTS,
  temporaryLocks: {
    first: LOCK_MINUTES_BY_LEVEL[1],
    second: LOCK_MINUTES_BY_LEVEL[2],
  },
  permanentAfterThirdBlock: true,
};
