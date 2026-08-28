import express from "express";
import multer from "multer";
import Membership from "../models/Membership.js";
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