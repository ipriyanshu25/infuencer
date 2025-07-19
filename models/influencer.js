const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Import new reference models
const Platform = require('../models/platform');
const Audience = require('../models/audienceRange');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
const phoneRegex = /^[0-9]{10}$/;
const urlRegex = /^(https?:\/\/)?([\w\-])+\.{1}[a-zA-Z]{2,}(\/\S*)?$/;

const influencerSchema = new mongoose.Schema({
  influencerId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },

  // Basic info (post-OTP)
  name: { type: String, required: function () { return this.otpVerified; } },
  email: { type: String, required: true, unique: true, match: [emailRegex, 'Invalid email'] },
  password: { type: String, minlength: 8, required: function () { return this.otpVerified; } },
  phone: { type: String, match: [phoneRegex, 'Invalid phone'], required: function () { return this.otpVerified; } },
  socialMedia: { type: String, required: function () { return this.otpVerified; } },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], required: function () { return this.otpVerified; } },
  profileLink: { type: String, match: [urlRegex, 'Invalid URL'], required: function () { return this.otpVerified; } },
  profileImage: { type: String, required: function () { return this.otpVerified; } },

  // Audience demographics
  audienceBifurcation: {
    malePercentage: { type: Number, min: 0, max: 100, required: function () { return this.otpVerified; } },
    femalePercentage: { type: Number, min: 0, max: 100, required: function () { return this.otpVerified; } }
  },

  // Categories (1–3)
 categories: {
    type: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Interest',
      required: true 
    }],
    validate: {
      validator: function(arr) {
        // only enforce once otpVerified is true
        if (!this.otpVerified) return true;
        return arr.length >= 1 && arr.length <= 3;
      },
      message: 'You must select between 1 and 3 categories.'
    },
    required: function() { return this.otpVerified; }
  },
  categoryName: {
    type: String,
    default: ''
  },
  // Platform reference; denormalized name for manual or display
  platformId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Platform',
    required: function () { return this.otpVerified; }
  },
  platformName: {
    type: String,
    required: function () { return this.otpVerified; }
  },

  // Age-range reference; denormalized range for display
  audienceAgeRangeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Audience',
    required: function () { return this.otpVerified; }
  },
  audienceAgeRange: {
    type: String,
    required: function () { return this.otpVerified; }
  },

  // Legacy audience count range
  audienceId: { type: mongoose.Schema.Types.ObjectId, ref: 'AudienceRange', required: function () { return this.otpVerified; } },
  audienceRange: { type: String, required: function () { return this.otpVerified; } },

  // Location
  countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: function () { return this.otpVerified; } },
  county: { type: String, required: function () { return this.otpVerified; } },
  callingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: function () { return this.otpVerified; } },
  callingcode: { type: String, required: function () { return this.otpVerified; } },

  bio: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },

  // OTP fields
  otpCode: { type: String },
  otpExpiresAt: { type: Date },
  otpVerified: { type: Boolean, default: false },

  passwordResetCode: { type: String },
  passwordResetExpiresAt: { type: Date },
  passwordResetVerified: { type: Boolean, default: false },

  // Subscription
  subscription: {
    planName: { type: String, required: true, default: 'free' },
    planId: { type: String, ref: 'SubscriptionPlan', required: true, default: 'a58683f0-8d6e-41b0-addd-a718c2622142' },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
    features: {
      type: [new mongoose.Schema({ key: { type: String, required: true }, limit: { type: Number, required: true }, used: { type: Number, required: true } }, { _id: false })],
      default: []
    }
  },
  subscriptionExpired: { type: Boolean, default: false }

}, { timestamps: true });

// Password hashing
influencerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password helper
influencerSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Influencer', influencerSchema);
