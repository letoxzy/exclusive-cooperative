import crypto from "crypto";
import Withdrawal from "../models/Withdrawal.js";
import { callInternal } from "./internalApi.js";
import { createTtlCache } from "./ttlCache.js";
import { sendSms, normalizeNgPhone } from "../sms.js";

/**
 * Withdrawals over USSD.
 *
 * This does NOT re-implement any withdrawal rule. Every check (the 40% /
 * once-a-month savings rule, the unpaid-loan block, loan-fund availability, the
 * withdrawal PIN and its lock-out, the Paystack transfer, idempotency and
 * rollback) is done by the existing /api/withdrawals routes, which USSD calls
 * the same way the mobile app does (see utils/internalApi.js).
 *
 * What this file adds, ONLY for USSD (the app is unchanged):
 *   - the screens,
 *   - USSD_WITHDRAW_REQUIRE_NAME_MATCH (default on): the bank account name that
 *     Paystack returns must match the member's registered name,
 *   - USSD_WITHDRAW_DAILY_LIMIT (default NGN 100,000): the most a member can
 *     withdraw in any rolling 24 hours (all channels count; 0 turns it off),
 *   - an immediate SMS to the member's phone for every withdrawal.
 *
 * Off unless USSD_WITHDRAWALS_ENABLED=true.
 *
 * Screens (after PIN and "7"): source -> bank -> account number -> account name
 * -> amount -> confirm -> withdrawal PIN. "0" cancels back to the main menu.
 */

export const withdrawalsEnabled = () =>
  String(process.env.USSD_WITHDRAWALS_ENABLED || "").toLowerCase() === "true";

const requireNameMatch = () =>
  String(process.env.USSD_WITHDRAW_REQUIRE_NAME_MATCH ?? "true").toLowerCase() !== "false";

const dailyLimit = () => {
  const n = Number(process.env.USSD_WITHDRAW_DAILY_LIMIT ?? 100000);
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 = no extra cap
};

const naira = (n) => `NGN ${Number(n || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const con = (text) => ({ type: "con", text });
const end = (text) => ({ type: "end", text });

// ---- banks shown on screen ---------------------------------------------------
// A phone keypad can only type digits, so members pick from a short list of the
// most used banks. Codes and exact names always come from your own
// GET /api/withdrawals/banks (Paystack); a bank missing from that list is
// simply not offered.
const POPULAR = [
  ["Access", /^access bank(?!.*diamond)/i],
  ["GTBank", /guaranty trust/i],
  ["UBA", /united bank for africa/i],
  ["First Bank", /^first bank/i],
  ["Zenith", /^zenith/i],
  ["Opay", /opay/i],
  ["Palmpay", /palmpay/i],
  ["Moniepoint", /moniepoint/i],
  ["Kuda", /^kuda/i],
  ["Fidelity", /^fidelity/i],
  ["Sterling", /^sterling/i],
  ["Union", /^union bank/i],
  ["Wema", /^wema/i],
  ["Stanbic", /^stanbic/i],
  ["FCMB", /first city monument|^fcmb/i],
  ["Polaris", /^polaris/i],
];
const PAGE_SIZE = 7;

const banksCache = createTtlCache(60 * 60 * 1000, 2);
async function popularBanks(userId) {
  const cached = banksCache.get("banks");
  if (cached) return cached;

  const res = await callInternal(userId, "GET", "/withdrawals/banks");
  if (!res.ok || !Array.isArray(res.data)) return null;

  const list = [];
  for (const [label, pattern] of POPULAR) {
    const bank = res.data.find((b) => pattern.test(String(b.name)));
    if (bank && !list.some((x) => x.code === bank.code)) list.push({ label, code: bank.code, name: bank.name });
  }
  if (list.length) banksCache.set("banks", list);
  return list.length ? list : null;
}

// Paystack name lookups are slow and USSD replays earlier steps, so remember
// the answer for a few minutes.
const nameCache = createTtlCache(3 * 60 * 1000);

// ---- name matching ------------------------------------------------------------
const tokens = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

/** True when enough of the member's registered name appears in the account name. */
export function namesMatch(memberName, accountName) {
  const mine = tokens(memberName);
  const theirs = new Set(tokens(accountName));
  if (!mine.length || !theirs.size) return false;
  const hits = mine.filter((t) => theirs.has(t)).length;
  return hits >= Math.min(2, mine.length);
}

// ---- daily cap -----------------------------------------------------------------
async function withdrawnLast24h(userId) {
  const rows = await Withdrawal.find({
    user: userId,
    createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
    status: { $in: ["processing", "success"] },
  })
    .select("amount")
    .lean();
  return rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

// ---- what the member can withdraw (from the same endpoint the app uses) -------
function sourcesFrom(me) {
  const options = [];
  if (!me.hasOutstandingLoan && Number(me.availableAmount) > 0) {
    options.push({ key: "savings", label: "Savings", max: Number(me.availableAmount) });
  }
  if (me.loanFunds?.hasActiveLoan && Number(me.loanFunds.availableAmount) > 0) {
    options.push({ key: "loan", label: "Loan funds", max: Number(me.loanFunds.availableAmount) });
  }
  return options;
}

function nothingAvailable(me) {
  if (me.hasOutstandingLoan) return "Savings cannot be withdrawn while a loan is unpaid.";
  if (me.monthlyWithdrawalUsed) return "You have already withdrawn from savings this month.";
  if (!Number(me.currentMonthContribution)) return "Make a contribution this month to be able to withdraw.";
  return "You have nothing available to withdraw right now.";
}

const maskedAccount = (n) => `****${String(n).slice(-4)}`;

// ---- the wizard ----------------------------------------------------------------
/**
 * @param inputs everything the member typed AFTER choosing "Withdraw" in the menu
 * @param ctx    { member, phoneNumber, sessionId }
 * @returns {{type:"con"|"end", text:string} | {back:true, used:number}}
 */
export async function runWithdrawal(inputs, ctx) {
  const userId = ctx.member._id;
  let i = 0;
  const more = () => i < inputs.length;
  const take = () => inputs[i++];
  const cancelled = () => ({ back: true, used: i }); // i is already past the "0"
  const invalid = () => end("Invalid choice. Dial again.");

  // Withdrawal PIN must exist (members create it in the app or, for
  // button-phone members, when the office activates them).
  const pinStatus = await callInternal(userId, "GET", "/withdrawals/pin/status");
  if (!pinStatus.ok) return end("Withdrawals are unavailable right now. Please try later.");
  if (!pinStatus.data?.hasWithdrawalPin) {
    return end("You have no withdrawal PIN yet. Ask the cooperative office to set one up.");
  }

  const meRes = await callInternal(userId, "GET", "/withdrawals/me");
  if (!meRes.ok || !meRes.data) return end("Unable to check your withdrawal limit. Please try later.");
  const me = meRes.data;

  // 1. source
  const sources = sourcesFrom(me);
  if (!sources.length) return end(nothingAvailable(me));

  if (!more()) {
    return con(
      `Withdraw from:\n${sources.map((s, n) => `${n + 1}. ${s.label}: ${naira(s.max)}`).join("\n")}\n0. Cancel`
    );
  }
  const sourceInput = take();
  if (sourceInput === "0") return cancelled();
  const source = sources[Number(sourceInput) - 1];
  if (!source || !/^\d$/.test(sourceInput)) return invalid();

  // 2. bank
  const banks = await popularBanks(userId);
  if (!banks) return end("Unable to load banks right now. Please try later.");

  let page = 0;
  let bank = null;
  while (!bank) {
    const start = page * PAGE_SIZE;
    const slice = banks.slice(start, start + PAGE_SIZE);
    const hasNext = start + PAGE_SIZE < banks.length;

    if (!more()) {
      const lines = slice.map((b, n) => `${n + 1}. ${b.label}`);
      if (hasNext) lines.push("8. More banks");
      if (page > 0) lines.push("9. Back");
      return con(`Choose bank:\n${lines.join("\n")}\n0. Cancel`);
    }
    const choice = take();
    if (choice === "0") return cancelled();
    if (choice === "8" && hasNext) { page += 1; continue; }
    if (choice === "9" && page > 0) { page -= 1; continue; }
    const picked = /^[1-7]$/.test(choice) ? slice[Number(choice) - 1] : null;
    if (!picked) return invalid();
    bank = picked;
  }

  // 3. account number
  if (!more()) return con(`${bank.label}\nEnter the 10-digit account number:`);
  const accountNumber = take();
  if (accountNumber === "0") return cancelled();
  if (!/^\d{10}$/.test(accountNumber)) return end("Invalid account number. Dial again.");

  // 4. account name (looked up by Paystack through your own verify route)
  const nameKey = `${userId}:${bank.code}:${accountNumber}`;
  let accountName = nameCache.get(nameKey);
  if (!accountName) {
    const verified = await callInternal(userId, "POST", "/withdrawals/verify-account", {
      body: { accountNumber, bankCode: bank.code },
    });
    if (!verified.ok || !verified.data?.accountName) {
      return end(verified.data?.message || "Could not verify this bank account.");
    }
    accountName = String(verified.data.accountName);
    nameCache.set(nameKey, accountName);
  }

  if (requireNameMatch() && !namesMatch(ctx.member.fullName, accountName)) {
    // Deliberately does not show the name: this must not be a way to look up
    // who owns an account number.
    return end("This account is not in your name. Please visit the cooperative office to withdraw to it.");
  }

  if (!more()) return con(`${accountName}\n${bank.label} ${maskedAccount(accountNumber)}\n1. Continue\n2. Cancel`);
  const nameConfirm = take();
  if (nameConfirm === "2" || nameConfirm === "0") return cancelled();
  if (nameConfirm !== "1") return invalid();

  // 5. amount
  if (!more()) return con(`Enter amount in NGN (max ${naira(source.max)}):`);
  const amountInput = take();
  if (amountInput === "0") return cancelled();
  if (!/^\d{1,9}$/.test(amountInput) || Number(amountInput) <= 0) return end("Invalid amount. Dial again.");
  const amount = Number(amountInput);
  if (amount > source.max) return end(`The most you can withdraw now is ${naira(source.max)}.`);

  const cap = dailyLimit();
  if (cap) {
    const remaining = Math.max(0, cap - (await withdrawnLast24h(userId)));
    if (amount > remaining) {
      return end(
        remaining > 0
          ? `USSD daily limit is ${naira(cap)}. You can withdraw ${naira(remaining)} more in the next 24 hours.`
          : `You have reached the USSD daily limit of ${naira(cap)}. Try again later or visit the office.`
      );
    }
  }

  // 6. confirm
  if (!more()) {
    return con(`Withdraw ${naira(amount)} (${source.label}) to ${accountName}, ${bank.label} ${maskedAccount(accountNumber)}?\n1. Confirm\n2. Cancel`);
  }
  const confirm = take();
  if (confirm === "2" || confirm === "0") return cancelled();
  if (confirm !== "1") return invalid();

  // 7. withdrawal PIN
  if (!more()) return con("Enter your 4-digit withdrawal PIN:");
  const pin = take();
  if (pin === "0") return cancelled();
  if (!/^\d{4}$/.test(pin)) return end("Invalid PIN. Dial again.");
  if (more()) return invalid();

  // Same intent in the same session always gets the same key, so a repeated
  // delivery of this request can never send the money twice.
  const idempotencyKey = `ussd-${crypto
    .createHash("sha256")
    .update(`${ctx.sessionId}|${userId}|${inputs.join("*")}`)
    .digest("hex")
    .slice(0, 40)}`;

  const result = await callInternal(userId, "POST", "/withdrawals", {
    idempotencyKey,
    body: {
      source: source.key,
      amount,
      pin,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber,
      accountName,
    },
  });

  if (result.uncertain) {
    return end("We could not confirm your withdrawal. It may still have gone through. Check your SMS before trying again.");
  }
  if (!result.ok) {
    return end(result.data?.message || "We could not process your withdrawal.");
  }

  // Immediate alert to the member's phone (money just moved by USSD).
  const phone = normalizeNgPhone(ctx.phoneNumber);
  if (phone) {
    sendSms(
      phone,
      `Exclusive Cooperative: A withdrawal of ${naira(amount)} to ${bank.label} ${maskedAccount(accountNumber)} was requested by USSD from your phone. If this was not you, contact the cooperative immediately.`
    ).catch((err) => console.error("[ussd] withdrawal SMS failed:", err?.message || err));
  }

  return end(`Withdrawal of ${naira(amount)} submitted to ${accountName}. You will get an SMS when it completes.`);
}
