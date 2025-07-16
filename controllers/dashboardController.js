// controllers/dashboardController.js
const Brand      = require('../models/brand');
const Campaign   = require('../models/campaign');
const Influencer = require('../models/influencer');
const Milestone  = require('../models/milestone');

async function getDashboard(req, res) {
  try {
    const { brandId } = req.body;
    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required in the request body' });
    }

    // 1. Find the brand and get its name
    const brand = await Brand.findOne({ brandId });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    const brandName = brand.name;

    // 2. Count active campaigns for this brand
    const totalActiveCampaigns = await Campaign.countDocuments({
      brandId,
      isActive: 1
    });

    // 3. Count all influencers in the database
    const totalInfluencers = await Influencer.countDocuments();

    // 4. Get wallet balance (budget remaining) for this brand
    const milestone = await Milestone.findOne({ brandId });
    const budgetRemaining = milestone ? milestone.walletBalance : 0;

    // 5. Respond with the dashboard data
    return res.status(200).json({
      brandName,
      totalActiveCampaigns,
      totalInfluencers,
      budgetRemaining
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getDashboard };
