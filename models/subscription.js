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
    required: true
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
