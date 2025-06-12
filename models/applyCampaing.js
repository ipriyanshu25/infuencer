const mongoose = require('mongoose');

const applicantSchema = new mongoose.Schema({
  influencerId: { type: String, required: true },
  name:         { type: String, required: true }
}, { _id: false });

const applyCampaingsSchema = new mongoose.Schema({
  campaignId: {
    type: String,
    required: true,
    unique: true
  },
  applicants: {
    type: [applicantSchema],
    default: []
  },
   createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('ApplyCampaing', applyCampaingsSchema);
