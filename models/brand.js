// models/brand.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
const phoneRegex = /^[0-9]{10}$/;

const subscriptionFeatureSchema = new mongoose.Schema({
  key: { type: String, required: true },
  limit: { type: Number, required: true },
  used: { type: Number, default: 0 }
}, { _id: false });

const subscriptionSchema = new mongoose.Schema({
  planName: { type: String, required: true, default: 'free' },
  planId: { type: String, ref: 'Subscription', required: true, default: 'ca41f2c1-7fbd-4e22-b27c-d537ecbaf02a' },
  startedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  features: { type: [subscriptionFeatureSchema], default: [] }
}, { _id: false });

const brandSchema = new mongoose.Schema({
  brandId: { type: String, required: true, unique: true, default: uuidv4 },

  // only required once otpVerified === true
  name: { type: String, required: function () { return this.otpVerified; } },
  password: {
    type: String,
    minlength: 8,
    required: function () { return this.otpVerified; }
  },
  phone: { type: String, match: [phoneRegex, 'Invalid phone'], required: function () { return this.otpVerified; } },
  county: { type: String, required: function () { return this.otpVerified; } },
  callingcode: { type: String, required: function () { return this.otpVerified; } },
  countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: function () { return this.otpVerified; } },
  callingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: function () { return this.otpVerified; } },

  // always required
  email: { type: String, required: true, unique: true, match: [emailRegex, 'Invalid email'] },
  createdAt: { type: Date, default: Date.now },

  // OTP fields — used before full registration
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
  otpVerified: { type: Boolean, default: false },
  
  passwordResetCode: { type: String },
  passwordResetExpiresAt: { type: Date },
  passwordResetVerified: { type: Boolean, default: false },

  // subscription sub-doc…
  subscription: { type: subscriptionSchema, default: () => ({}) },
  subscriptionExpired: { type: Boolean, default: false }
}, { timestamps: true });

// Hash password before saving
brandSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password helper
brandSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Brand', brandSchema);
