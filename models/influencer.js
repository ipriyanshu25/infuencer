// models/Influencer.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Regular expressions for validating email and phone number formats
const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
const phoneRegex = /^[0-9]{10}$/;

// ——— Define a small sub-schema for per-feature quotas ———
const subscriptionFeatureSchema = new mongoose.Schema({
  key:   { type: String, required: true},
  limit: { type: Number, required: true},
  used:  { type: Number, required: true}
}, { _id: false });

// ——— Main Influencer schema ———
const influencerSchema = new mongoose.Schema({
  influencerId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  name:       { type: String, required: true },
  email:      { type: String, required: true, unique: true, match: [emailRegex, 'Invalid email'] },
  password:   { type: String, required: true, minlength: 8 },
  phone:      { type: String, required: true, match: [phoneRegex, 'Invalid phone'] },
  socialMedia:{ type: String, required: true },

  // Category & audience
  categoryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Interest', required: true },
  categoryName: { type: String, required: true },
  audienceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'AudienceRange', required: true },
  audienceRange:{ type: String, required: true },

  // Location & contact
  callingcode: { type: String, required: true },
  county:      { type: String, required: true },
  countryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  callingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },

  bio:       { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },

  // ——— Subscription subdoc ———
  subscription: {
    planName: { type: String, required: true, default: 'free' },
    planId: {
      type: String,
      ref: 'SubscriptionPlan',
      required: true,
      default: 'a58683f0-8d6e-41b0-addc-a718c2622142'  // your Free tier planId
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date
    },
    // snapshot of all features & quotas for this plan
    features: {
      type: [subscriptionFeatureSchema],
      default: []
    }
  },

  // Flag to indicate if a paid subscription has expired
  subscriptionExpired: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// ─── Password hashing ─────────────────────────────────────────────────────
influencerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ─── Compare password method ───────────────────────────────────────────────
influencerSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Influencer', influencerSchema);
