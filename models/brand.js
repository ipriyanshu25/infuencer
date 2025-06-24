// models/brand.js
const mongoose      = require('mongoose');
const bcrypt        = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
const phoneRegex = /^[0-9]{10}$/;

// ─── Feature quota snapshot ─────────────────────────────
const subscriptionFeatureSchema = new mongoose.Schema({
  key:   { type: String, required: true },
  limit: { type: Number, required: true },
  used:  { type: Number, default: 0 }
}, { _id: false });

// ─── Subscription sub‐doc ────────────────────────────────
const subscriptionSchema = new mongoose.Schema({
  planId: {
    type:     String,
    ref:      'Subscription',
    required: true,
    default:  'ca41f2c1-7fbd-4e22-b27c-d537ecbaf02a'
  },
  startedAt: { type: Date,   default: Date.now },
  expiresAt: { type: Date },
  features:  { type: [subscriptionFeatureSchema], default: [] }
}, { _id: false });

// ─── Brand schema ────────────────────────────────────────
const brandSchema = new mongoose.Schema({
  brandId:     { type: String, required: true, unique: true, default: uuidv4 },
  name:        { type: String, required: true },
  email:       { type: String, required: true, unique: true, match: [emailRegex, 'Invalid email'] },
  password:    { type: String, required: true, minlength: 8 },
  phone:       { type: String, required: true, match: [phoneRegex, 'Invalid phone'] },
  county:      { type: String, required: true },
  callingcode: { type: String, required: true },
  countryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  callingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  createdAt:   { type: Date,   default: Date.now },

  // ensure the sub-doc always exists
  subscription: {
    type:    subscriptionSchema,
    default: () => ({})
  },

  subscriptionExpired: { type: Boolean, default: false }
}, { timestamps: true });

// Hash password before saving
brandSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password helper
brandSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Brand', brandSchema);
