// routes/emailRoutes.js
const express = require("express");
const multer = require("multer");
const { ocrImages } = require("../controllers/emailController");

const router = express.Router();

// keep files in memory; allow up to 5 images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5 }
});

// POST /api/ocr  (field name: images) – upload up to 5 at once
router.post("/extract", upload.array("images", 5), ocrImages);

module.exports = router;

// routes/emailRoutes.js
// 'use strict';

// const express = require('express');
// const multer = require('multer');
// const {
//   extractEmailsAndHandles,
//   extractEmailsAndHandlesBatch
// } = require('../controllers/emailController');

// const router = express.Router();

// // In-memory uploads for speed (no disk I/O)
// const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024, 10); // 10MB

// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: MAX_UPLOAD_BYTES },
//   fileFilter: (_req, file, cb) => {
//     if (!file) return cb(null, true);
//     if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) return cb(null, true);
//     return cb(new Error('Unsupported file type. Please upload PNG, JPG/JPEG, or WEBP.'));
//   }
// });

// // Accept ANY file field names, then we’ll pick up to 5 images.
// // This avoids "MulterError: Unexpected field" regardless of client field names.
// const acceptAnyUpload = upload.any();
// function capToFive(req, _res, next) {
//   if (Array.isArray(req.files) && req.files.length > 5) {
//     req.files = req.files.slice(0, 5);
//   }
//   next();
// }

// // ---- Single image ----
// router.post('/extract', acceptAnyUpload, (req, _res, next) => {
//   // Normalize first image to req.file for the single controller
//   if (Array.isArray(req.files) && req.files.length > 0) req.file = req.files[0];
//   next();
// }, extractEmailsAndHandles);

// // ---- Batch: up to 5 images ----
// router.post('/extract-batch', acceptAnyUpload, capToFive, extractEmailsAndHandlesBatch);

// // Optional: health
// router.get('/health', (_req, res) => res.json({ status: 'ok' }));

// module.exports = router;

