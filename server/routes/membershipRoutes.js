import express from "express";
import multer from "multer";
import Membership from "../models/Membership.js";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";

const router = express.Router();

// Files are held in memory just long enough to stream to Cloudinary —
// never written to disk.
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/membership/me
router.get("/me", protect, async (req, res) => {
  const application = await Membership.findOne({ user: req.user._id });
  res.json(application);
});

// PATCH /api/membership/me
// Members can update their existing membership details from their profile.
// Sensitive application-only fields (savings setup, membership type,
// declaration, uploaded documents) remain unchanged here.
const MEMBER_EDITABLE_FIELDS = [
  "fullName",
  "gender",
  "phone",
  "email",
  "employmentStatus",
  "employmentOther",
  "lga",
  "dob",
  "maritalStatus",
  "whatsapp",
  "occupation",
  "stateOfOrigin",
  "address",
  "kinName",
  "kinPhone",
  "kinAddress",
  "kinRelationship",
  "kinAltPhone",
  "kinEmail",
  "beneficiaryName",
  "beneficiaryPhone",
  "beneficiaryAddress",
  "beneficiaryRelationship",
];

router.patch("/me", protect, async (req, res) => {
  try {
    const application = await Membership.findOne({ user: req.user._id });

    if (!application) {
      return res.status(404).json({
        message: "No membership application was found for this account.",
      });
    }

    const updates = {};
    for (const field of MEMBER_EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        const value = typeof req.body[field] === "string" ? req.body[field].trim() : req.body[field];
        updates[field] = value;
      }
    }

    if (updates.fullName !== undefined && !updates.fullName) {
      return res.status(400).json({ message: "Full name cannot be empty." });
    }

    if (updates.email !== undefined) {
      updates.email = updates.email.toLowerCase();
      if (!updates.email) {
        return res.status(400).json({ message: "Email cannot be empty." });
      }

      const existingUser = await User.findOne({
        email: updates.email,
        _id: { $ne: req.user._id },
      });

      if (existingUser) {
        return res.status(409).json({ message: "That email address is already in use." });
      }
    }

    Object.assign(application, updates);
    await application.save();

    const userUpdates = {};
    if (updates.fullName !== undefined) userUpdates.fullName = updates.fullName;
    if (updates.email !== undefined) userUpdates.email = updates.email;

    if (Object.keys(userUpdates).length) {
      Object.assign(req.user, userUpdates);
      await req.user.save();
    }

    res.json(application);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/membership  (multipart/form-data)
router.post(
  "/",
  protect,
  upload.fields([{ name: "passportPhoto" }, { name: "signature" }]),
  async (req, res) => {
    try {
      const existing = await Membership.findOne({ user: req.user._id });
      if (existing) {
        return res.status(400).json({
          message: "You already have a membership application on file.",
        });
      }

      const passportFile = req.files?.passportPhoto?.[0];
      const signatureFile = req.files?.signature?.[0];

      const [passportResult, signatureResult] = await Promise.all([
        passportFile
          ? uploadBufferToCloudinary(passportFile.buffer, {
              folder: "exclusive-cooperative/membership",
            })
          : Promise.resolve(null),
        signatureFile
          ? uploadBufferToCloudinary(signatureFile.buffer, {
              folder: "exclusive-cooperative/membership",
            })
          : Promise.resolve(null),
      ]);

      const application = await Membership.create({
        ...req.body,
        user: req.user._id,
        passportPhotoUrl: passportResult?.secure_url,
        signatureUrl: signatureResult?.secure_url,
      });

      res.status(201).json(application);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;