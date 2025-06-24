// models/subscriptionPlan.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const featureSchema = new mongoose.Schema({
  key:   { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const subscriptionPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  role: {
    type: String,
    enum: ['Brand', 'Influencer'],
    required: true
  },
  name: {
    type: String,
    required: true
  },
  monthlyCost: {
    type: Number,
    required: true,
    min: 0
  },
  // Number of days each billing cycle lasts (e.g., 30-day rental)
  durationDays: {
    type: Number,
    default: 30,
    min: 1
  },
  // If true, plan will auto-renew (e.g., free tiers)
  autoRenew: {
    type: Boolean,
    default: false
  },
  // Allows deactivating or archiving a plan without deletion
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  features: {
    type: [featureSchema],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);