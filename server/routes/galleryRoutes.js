import express from "express";
import multer from "multer";

import Gallery from "../models/Gallery.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype.startsWith("image/");
    const isVideo = file.mimetype.startsWith("video/");

    if (isImage || isVideo) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed."));
    }
  },
});

// GET /api/gallery
// Public: visitors only see published gallery items.
router.get("/", async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { isPublished: true };

    if (category && category !== "All") {
      filter.category = category;
    }

    const items = await Gallery.find(filter).sort("-createdAt");
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/gallery/:id
// Public: only published item details are exposed.
router.get("/:id", async (req, res) => {
  try {
    const item = await Gallery.findOne({
      _id: req.params.id,
      isPublished: true,
    });

    if (!item) {
      return res.status(404).json({ message: "Gallery item not found." });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Everything below this point requires an administrator.
router.use(protect, adminOnly);

// GET /api/gallery/admin/all
router.get("/admin/all", async (req, res) => {
  try {
    const items = await Gallery.find().sort("-createdAt");
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/gallery/admin
router.post("/admin", upload.single("media"), async (req, res) => {
  try {
    const { title, description, category, isPublished } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Gallery title is required." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Please choose an image or video." });
    }

    const mediaType = req.file.mimetype.startsWith("video/") ? "video" : "image";
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "exclusive-cooperative/gallery",
      resource_type: mediaType,
    });

    const item = await Gallery.create({
      title: title.trim(),
      description: description?.trim() || "",
      category: category?.trim() || "Events",
      mediaType,
      mediaUrl: result.secure_url,
      publicId: result.public_id,
      resourceType: mediaType,
      isPublished: isPublished !== "false",
    });

    res.status(201).json(item);
  } catch (err) {
    console.error("Gallery upload error:", err);
    res.status(500).json({ message: err.message || "Failed to upload gallery item." });
  }
});

// PATCH /api/gallery/admin/:id
router.patch("/admin/:id", async (req, res) => {
  try {
    const allowedFields = ["title", "description", "category", "isPublished"];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (updates.title !== undefined) {
      updates.title = String(updates.title).trim();
      if (!updates.title) {
        return res.status(400).json({ message: "Gallery title is required." });
      }
    }

    if (updates.description !== undefined) {
      updates.description = String(updates.description).trim();
    }

    if (updates.category !== undefined) {
      updates.category = String(updates.category).trim() || "Events";
    }

    if (updates.isPublished !== undefined) {
      updates.isPublished =
        updates.isPublished === true || updates.isPublished === "true";
    }

    const item = await Gallery.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!item) {
      return res.status(404).json({ message: "Gallery item not found." });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/gallery/admin/:id
router.delete("/admin/:id", async (req, res) => {
  try {
    const item = await Gallery.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ message: "Gallery item not found." });
    }

    try {
      await cloudinary.uploader.destroy(item.publicId, {
        resource_type: item.resourceType,
        type: "upload",
      });
    } catch (cloudinaryError) {
      console.error("Cloudinary delete error:", cloudinaryError);
    }

    await item.deleteOne();

    res.json({ message: "Gallery item deleted successfully." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
