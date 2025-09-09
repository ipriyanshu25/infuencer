// models/verifyEmail.js
const mongoose = require('mongoose');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;

const verifyEmailSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, match: [emailRegex, 'Invalid email'] },
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  attempts: { type: Number, default: 0 } // number of OTP sends
}, { timestamps: true });

module.exports = mongoose.model('VerifyEmail', verifyEmailSchema);
