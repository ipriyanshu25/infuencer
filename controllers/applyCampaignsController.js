// controllers/applyCampaingsController.js

const ApplyCampaing = require('../models/applyCampaign');
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
      // first application for this campaign
      record = new ApplyCampaing({
        campaignId,
        applicants: [{ influencerId, name: inf.name }]
      });
    } else {
      // Check if influencer already applied
      const already = record.applicants.some(a => a.influencerId === influencerId);
      if (already) {
        return res.status(400).json({ message: 'Influencer has already applied to this campaign' });
      }
      // add new applicant
      record.applicants.push({ influencerId, name: inf.name });
    }

    // 3) Save the updated record
    await record.save();

    // 4) Compute new count and sync to Campaign
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


