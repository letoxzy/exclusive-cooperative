import "dotenv/config";
import AfricasTalking from "africastalking";

let client = null;

// Created on first use so the server still boots if AT_* is missing.
function getClient() {
  if (client) return client;
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) {
    throw new Error("AT_USERNAME / AT_API_KEY are not set");
  }
  client = AfricasTalking({ username, apiKey });
  return client;
}

// 0803..., 803..., 234803... and +234803... all become +234803...
export function normalizeNgPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("234")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  return null;
}

export async function sendSms(to, message) {
  const phone = normalizeNgPhone(to);
  if (!phone) throw new Error("Invalid Nigerian phone number");

  const options = { to: [phone], message };
  // Only set a sender ID once it is registered on Africa's Talking (live).
  if (process.env.AT_SENDER_ID) options.from = process.env.AT_SENDER_ID;

  return getClient().SMS.send(options);
}