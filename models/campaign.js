// models/campaigns.js

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const targetAudienceSchema = new mongoose.Schema({
  age: { type: Number },       // e.g. "18–25"
  gender: { type: String },    // e.g. "Male", "Female", "All"
  location: { type: String },  // e.g. "New York, USA"
  interest: { type: String }   // e.g. "Fitness Enthusiasts"
});

//
// Main Campaign schema
//
const campaignSchema = new mongoose.Schema({
  brandId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  campaignsId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  brandName: {
    type: String,
    required: true
  },
  productOrServiceName: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  targetAudience: {
    type: targetAudienceSchema,
    default: {}
  },
  goal: {
    type: String,
    enum: ['Brand Awareness', 'Sales', 'Engagement'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Campaign', campaignSchema);
