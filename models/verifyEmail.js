// models/verifyEmail.js
const mongoose = require('mongoose');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;

const verifyEmailSchema = new mongoose.Schema({
  email: { type: String, required: true, match: [emailRegex, 'Invalid email'] },
  role:  { type: String, enum: ['Brand', 'Influencer'], required: true },

  otpCode: { type: String },
  otpExpiresAt: { type: Date },

  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date },

  attempts: { type: Number, default: 0 } // number of OTP sends
}, { timestamps: true });

// Ensure one verification record per (email, role)
verifyEmailSchema.index({ email: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('VerifyEmail', verifyEmailSchema);
