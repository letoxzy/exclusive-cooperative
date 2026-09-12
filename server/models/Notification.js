import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "membership",
        "savings",
        "loan-eligibility",
        "loan",
        "repayment",
        "withdrawal",
        "dividend",
        "shareholding",
        "announcement",
        "security",
      ],
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    // Optional structured data for notifications that need an action,
    // such as downloading a payment receipt.
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },

    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Notification", notificationSchema);