import multer from 'multer';
import { env } from '../config/env.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.IMAGE_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
});

export function uploadSingleImage(req, res, next) {
  upload.single('arquivo')(req, res, next);
}
