// models/influencer.js
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
const phoneRegex = /^[0-9]{10}$/;

// ─── Payment SubSchema ─────────────────────────────────────────────────────────
const paymentSchema = new mongoose.Schema({
  paymentId: { type: String, default: uuidv4, unique: true, required: true },

  // 0 = PayPal, 1 = Bank
  type: { type: Number, enum: [0, 1], required: true },

  // Bank block (required only when type === 1)
  bank: {
    accountHolder: { type: String, required: function () { return this.type === 1; } },
    accountNumber: { type: String, required: function () { return this.type === 1; } },
    ifsc:          { type: String },  // India-specific; optional globally
    swift:         { type: String },  // International transfers
    bankName:      { type: String, required: function () { return this.type === 1; } },
    branch:        { type: String },
    country:       { type: String }
  },

  // PayPal block (required only when type === 0)
  paypal: {
    email:   { type: String, match: [emailRegex, 'Invalid PayPal email'], required: function () { return this.type === 0; } },
    paypalId:{ type: String } // optional secondary id/merchant id
  },

  isDefault: { type: Boolean, default: false } // only one should be true
}, { _id: false, timestamps: true });

/**
 * Ensure only one default payment method.
 * (Runs on the parent schema)
 */

// ─── Influencer Schema ────────────────────────────────────────────────────────
const influencerSchema = new mongoose.Schema({
  influencerId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },

  // Basic info (post-OTP)
  name:        { type: String, required: function() { return this.otpVerified; } },
  email:       { type: String, required: true, unique: true, match: [emailRegex, 'Invalid email'] },
  password:    { type: String, minlength: 8, required: function() { return this.otpVerified; } },
  phone:       { type: String, match: [phoneRegex, 'Invalid phone'], required: function() { return this.otpVerified; } },
  socialMedia: { type: String, required: function() { return this.otpVerified; } },

  gender: {
    type: Number,
    enum: [0, 1, 2],   // 0=Male, 1=Female, 2=Other
    required: function() { return this.otpVerified; }
  },

  profileLink:  { type: String, required: function() { return this.otpVerified; } },
  profileImage: { type: String, required: function() { return this.otpVerified; } },

  audienceBifurcation: {
    malePercentage:   { type: Number, min: 0, max: 100, required: function() { return this.otpVerified; } },
    femalePercentage: { type: Number, min: 0, max: 100, required: function() { return this.otpVerified; } }
  },

  categories: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Interest',
      required: true
    }],
    validate: {
      validator: function(arr) {
        if (!this.otpVerified) return true;
        return Array.isArray(arr) && arr.length >= 1 && arr.length <= 3;
      },
      message: 'You must select between 1 and 3 categories.'
    },
    required: function() { return this.otpVerified; }
  },

  categoryName: {
    type: [String],
    default: [],
    validate: {
      validator: function(arr) {
        if (!this.otpVerified) return true;
        return Array.isArray(arr) && arr.length === this.categories.length;
      },
      message: 'categoryName entries must correspond 1:1 with categories.'
    },
    required: function() { return this.otpVerified; }
  },

  platformId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Platform',
    required: function() { return this.otpVerified; }
  },
  platformName: {
    type: String,
    required: function() { return this.otpVerified; }
  },

  audienceAgeRangeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Audience',
    required: function() { return this.otpVerified; }
  },
  audienceAgeRange: {
    type: String,
    required: function() { return this.otpVerified; }
  },

  audienceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'AudienceRange', required: function() { return this.otpVerified; } },
  audienceRange:  { type: String, required: function() { return this.otpVerified; } },

  countryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: function() { return this.otpVerified; } },
  county:      { type: String, required: function() { return this.otpVerified; } },
  callingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: function() { return this.otpVerified; } },
  callingcode: { type: String, required: function() { return this.otpVerified; } },

  bio:         { type: String, default: '' },
  createdAt:   { type: Date, default: Date.now },

  // OTP fields
  otpCode:            { type: String },
  otpExpiresAt:       { type: Date },
  otpVerified:        { type: Boolean, default: false },

  passwordResetCode:      { type: String },
  passwordResetExpiresAt: { type: Date },
  passwordResetVerified:  { type: Boolean, default: false },

  // Payment methods (NEW)
  paymentMethods: {
    type: [paymentSchema],
    default: []
  },

  // Subscription
  subscription: {
    planName:  { type: String, required: true, default: 'free' },
    planId:    { type: String, ref: 'SubscriptionPlan', required: true, default: 'a58683f0-8d6e-41b0-addd-a718c2622142' },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    features: {
      type: [new mongoose.Schema({
        key:   { type: String, required: true },
        limit: { type: Number, required: true },
        used:  { type: Number, required: true }
      }, { _id: false })],
      default: []
    }
  },
  subscriptionExpired: { type: Boolean, default: false }

}, { timestamps: true });

// ─── Hooks / Validators ───────────────────────────────────────────────────────

// Ensure one default payment
influencerSchema.pre('validate', function (next) {
  if (!this.paymentMethods || this.paymentMethods.length === 0) return next();
  const defaults = this.paymentMethods.filter(pm => pm.isDefault);
  if (defaults.length > 1) {
    return next(new Error('Only one payment method can be marked as default.'));
  }
  next();
});

// Hash password if modified
influencerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password helper
influencerSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Helper to set default payment by paymentId
influencerSchema.methods.setDefaultPayment = function (paymentId) {
  this.paymentMethods.forEach(pm => { pm.isDefault = (pm.paymentId === paymentId); });
  return this.save();
};

module.exports = mongoose.model('Influencer', influencerSchema);
