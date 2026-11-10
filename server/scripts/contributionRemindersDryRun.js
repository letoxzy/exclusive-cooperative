import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import { processContributionReminders } from "../services/contributionReminderService.js";

await connectDB();
const summary = await processContributionReminders({ dryRun: true });
console.log("Dry run (nothing was sent):", JSON.stringify(summary, null, 2));
await mongoose.disconnect();
