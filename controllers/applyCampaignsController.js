// controllers/applyCampaingsController.js

const ApplyCampaing = require('../models/applyCampaing');
const Campaign      = require('../models/campaign');
const Influencer    = require('../models/influencer');

exports.applyToCampaign = async (req, res) => {
  const { campaignId, influencerId } = req.body;
  if (!campaignId || !influencerId) {
    return res.status(400).json({ message: 'Both campaignId and influencerId are required' });
  }

  try {
    // 1) Lookup influencer to get name
    const inf = await Influencer.findOne({ influencerId }, 'influencerId name');
    if (!inf) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    // 2) Find or create the application record
    let record = await ApplyCampaing.findOne({ campaignId });
    if (!record) {
      record = new ApplyCampaing({
        campaignId,
        applicants: [{ influencerId, name: inf.name }]
      });
    } else {
      // Only add if influencer hasn't applied yet
      const already = record.applicants.some(a => a.influencerId === influencerId);
      if (!already) {
        record.applicants.push({ influencerId, name: inf.name });
      }
    }

    // Save the updated record
    await record.save();

    // 3) Compute new count and sync to Campaign
    const applicantCount = record.applicants.length;
    await Campaign.findOneAndUpdate(
      { campaignsId: campaignId },
      { applicantCount }
    );

    return res.status(200).json({
      message: 'Application recorded',
      campaignId,
      applicantCount
    });
  } catch (err) {
    console.error('Error in applyToCampaign:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /applyCampaings/list
// body: { campaignId: String }
exports.getListByCampaign = async (req, res) => {
  const { campaignId } = req.body;
  if (!campaignId) {
    return res.status(400).json({ message: 'campaignId is required' });
  }

  try {
    const record = await ApplyCampaing.findOne({ campaignId });
    if (!record) {
      return res.status(200).json({ influencers: [], applicantCount: 0 });
    }

    // Build influencer list
    const influencers = record.applicants.map(a => ({
      influencerId: a.influencerId,
      name:         a.name
    }));
    const applicantCount = record.applicants.length;

    return res.status(200).json({
      influencers,
      applicantCount
    });
  } catch (err) {
    console.error('Error in getListByCampaign:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
