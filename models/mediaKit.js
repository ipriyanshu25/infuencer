const mongoose = require('mongoose');

const countrySchema = new mongoose.Schema(
  { label: String, percentage: Number },
  { _id: false }
);

const ageSchema = new mongoose.Schema(
  { label: String, percentage: Number },
  { _id: false }
);

const mediaKitSchema = new mongoose.Schema(
  {
    influencerId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    profileImage: String,
    bio: String,
    followers: Number,
    engagementRate: Number,

    platformName: String,
    categories: [String],

    audienceBifurcation: {
      malePercentage: { type: Number, min: 0, max: 100 },
      femalePercentage: { type: Number, min: 0, max: 100 },
    },

    topCountries: [countrySchema],
    ageBreakdown: [ageSchema],
    interests: [String],
    gallery: [String],

    mediaKitPdf: String,
    email: String,
    website: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('MediaKit', mediaKitSchema);
