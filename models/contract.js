const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const contractSchema = new mongoose.Schema({
  contractId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  campaignId: {
    type: String,
    required: true,
    ref: 'Campaign'
  },
  brandName: {
    type: String,
    required: true
  },
  brandAddress: {
    type: String,
    required: true
  },
  influencerName: {
    type: String,
    required: true
  },
  influencerAddress: {
    type: String,
    required: true
  },
  influencerHandle: {
    type: String,
    required: true
  },
  effectiveDate: {
    type: String,
    required: true
  },
  deliverableDescription: {
    type: String,
    required: true
  },
  feeAmount: {
    type: String,
    required: true
  },
  // removed `term` sub‐document (no longer used)
  timeline: {
    startDate: { type: Date },
    endDate:   { type: Date }
  },
  type: {
    type: Number, // 0 = PDF only, 1 = save
    required: true
  },
  isAccepted: {
    type: Number,
    default: 0
  },
  isAssigned: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Contract', contractSchema);
