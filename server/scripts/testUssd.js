// Simulates Africa's Talking calling your /api/ussd route, so you can try the
// menu from the terminal before using the AT simulator.
//
//   node scripts/testUssd.js 08012345678
//
// Needs the server running locally and USSD_CALLBACK_TOKEN in your .env.
import "dotenv/config";
import readline from "node:readline/promises";

const phone = process.argv[2] || "+2348012345678";
const base = process.env.USSD_TEST_URL || `http://localhost:${process.env.PORT || 5000}/api/ussd`;
const url = `${base}?token=${encodeURIComponent(process.env.USSD_CALLBACK_TOKEN || "")}`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sessionId = `test-${Date.now()}`;
let text = "";

for (;;) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ sessionId, serviceCode: "*384*1#", phoneNumber: phone, text }),
  });
  const body = await res.text();
  console.log("\n" + body.replace(/^(CON|END) /, "") + "\n");
  if (body.startsWith("END") || !res.ok) break;
  const input = await rl.question("> ");
  text = text ? `${text}*${input}` : input;
}
rl.close();