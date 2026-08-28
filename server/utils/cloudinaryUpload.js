import { Readable } from "stream";
import cloudinary from "../config/cloudinary.js";

// Uploads an in-memory file buffer (from multer's memoryStorage) straight
// to Cloudinary — no local disk, no third-party multer-storage wrapper.
export const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    Readable.from(buffer).pipe(uploadStream);
  });