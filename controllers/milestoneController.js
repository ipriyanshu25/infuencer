// controllers/milestoneController.js

const Milestone = require('../models/milestone');
const Campaign  = require('../models/campaign');

// POST /milestone/create
// body: { brandId, influencerId, campaignId, milestoneTitle, amount, milestoneDescription }
exports.createMilestone = async (req, res) => {
  const {
    brandId,
    influencerId,
    campaignId,
    milestoneTitle,
    amount,
    milestoneDescription = ''
  } = req.body;

  if (!brandId || !influencerId || !campaignId || !milestoneTitle || amount == null) {
    return res.status(400).json({
      message: 'brandId, influencerId, campaignId, milestoneTitle and amount are required'
    });
  }

  try {
    // 1) Verify the campaign exists
    const camp = await Campaign.findOne({ campaignsId: campaignId });
    if (!camp) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // 2) Find or create the brand’s Milestone document
    let doc = await Milestone.findOne({ brandId });
    if (!doc) {
      doc = new Milestone({ brandId });
    }

    // 3) Append a new history entry
    const entry = {
      influencerId,
      campaignId,
      milestoneTitle,
      amount,
      milestoneDescription
    };
    doc.milestoneHistory.push(entry);

    // 4) Update walletBalance
    doc.walletBalance = (doc.walletBalance || 0) + amount;

    // 5) Save
    await doc.save();

    return res.status(201).json({
      message: 'Milestone created',
      walletBalance: doc.walletBalance,
      entry
    });
  } catch (err) {
    console.error('Error in createMilestone:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /milestone/list
// body: { campaignId }
exports.getMilestonesByCampaign = async (req, res) => {
  const { campaignId } = req.body;
  if (!campaignId) {
    return res.status(400).json({ message: 'campaignId is required' });
  }

  try {
    // 1) Find all brand docs that have history for this campaign
    const docs = await Milestone.find({ 'milestoneHistory.campaignId': campaignId }).lean();

    // 2) Extract and flatten only the entries for campaignId
    const entries = docs.flatMap(doc =>
      doc.milestoneHistory
        .filter(e => e.campaignId === campaignId)
        .map(e => ({
          ...e,
          brandId: doc.brandId,
          // optionally include the brand’s walletBalance at time of fetch:
          walletBalance: doc.walletBalance
        }))
    );

    return res.status(200).json({
      message: 'Milestones fetched',
      milestones: entries
    });
  } catch (err) {
    console.error('Error in getMilestonesByCampaign:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /milestone/balance
// body: { brandId }
exports.getWalletBalance = async (req, res) => {
  const { brandId } = req.body;
  if (!brandId) {
    return res.status(400).json({ message: 'brandId is required' });
  }

  try {
    const doc = await Milestone.findOne({ brandId }).lean();
    const balance = doc ? doc.walletBalance : 0;
    return res.status(200).json({
      message: 'Wallet balance fetched',
      brandId,
      balance
    });
  } catch (err) {
    console.error('Error in getWalletBalance:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
