import { sendSms } from "./sms.js";

// Usage (from the server folder): node test-sms.js 08012345678
const to = process.argv[2] || "+2348012345678";

sendSms(to, "Test from Exclusive Cooperative")
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => console.error("SMS failed:", e.message));
