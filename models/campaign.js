// models/campaigns.js

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const targetAudienceSchema = new mongoose.Schema({
  age: {
    MinAge: { type: Number },   // e.g. 18
    MaxAge: { type: Number }    // e.g. 35
  },
  gender: {
    type: Number,
    enum: [0, 1, 2],            // 0 → Female, 1 → Male, 2 → All
    required: true,
    default: 2                  // default to “All”
  },
  location: { type: String }    // free-form location, e.g. "New York, USA"
});

//
// Main Campaign schema
//
const campaignSchema = new mongoose.Schema({
  brandId: {
    type: String,
    required: true,
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
    type: String,
    default: ''
  },
  targetAudience: {
    type: targetAudienceSchema,
    default: () => ({
      age: { MinAge: 0, MaxAge: 0 },
      gender: 2,         // “All” by default
      location: ''
    })
  },
  // Array of ObjectId references to the Interest collection:
  interestId: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Interest'
    }
  ],
  // A convenience field to store a comma-separated list of interest names:
  interestName: {
    type: String,
    default: ''
  },
  goal: {
    type: String,
    enum: ['Brand Awareness', 'Sales', 'Engagement'],
    required: true
  },
  budget: {
    type: Number,
    default: 0
  },
  timeline: {
    startDate: { type: Date },
    endDate:   { type: Date }
  },
  // NEW: store multiple image file paths here
  images: [
    {
      type: String  // e.g. "uploads/sneaker_1623456789012.jpg"
    }
  ],
  // UPDATED: now creativeBrief is an array of file paths (for PDFs/docs)
  creativeBrief: [
    {
      type: String  // e.g. "uploads/brief_1623456789013.pdf"
    }
  ],
  additionalNotes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Campaign', campaignSchema);
