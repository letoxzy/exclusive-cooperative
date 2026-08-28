// Run this once with `npm run seed:admin` to create (or promote) an admin
// account. Admins are never created through the public /register endpoint.
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import User from "./models/User.js";

dotenv.config();

const run = async () => {
  await connectDB();

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME || "Administrator";

  if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file first.");
    process.exit(1);
  }

  let admin = await User.findOne({ email });

  if (admin) {
    admin.role = "admin";
    admin.fullName = fullName;
    admin.password = password; // re-hashed automatically by the pre-save hook
    await admin.save();
    console.log(`Existing user ${email} promoted to admin.`);
  } else {
    admin = await User.create({ fullName, email, password, role: "admin" });
    console.log(`Admin account created: ${email}`);
  }

  process.exit(0);
};

run();
