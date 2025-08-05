// controllers/milestoneController.js

const Milestone = require('../models/milestone');
const Campaign = require('../models/campaign');

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

  // 0) Coerce and validate amount
  const amountNum = Number(amount);
  if (isNaN(amountNum)) {
    return res.status(400).json({
      message: 'amount must be a valid number'
    });
  }

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

    // 3) Append a new history entry (using numeric amount)
    const entry = {
      influencerId,
      campaignId,
      milestoneTitle,
      amount: amountNum,
      milestoneDescription
    };
    doc.milestoneHistory.push(entry);

    // 4) Update walletBalance
    doc.walletBalance = (doc.walletBalance || 0) + amountNum;

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

// POST /milestone/listByCampaign
// body: { campaignId }
exports.getMilestonesByCampaign = async (req, res) => {
  const { campaignId } = req.body;
  if (!campaignId) {
    return res.status(400).json({ message: 'campaignId is required' });
  }

  try {
    const docs = await Milestone.find({ 'milestoneHistory.campaignId': campaignId }).lean();

    const entries = docs.flatMap(doc =>
      doc.milestoneHistory
        .filter(e => e.campaignId === campaignId)
        .map(e => ({
          ...e,
          brandId: doc.brandId,
          walletBalance: doc.walletBalance
        }))
    );

    return res.status(200).json({
      message: 'Milestones fetched by campaign',
      milestones: entries
    });
  } catch (err) {
    console.error('Error in getMilestonesByCampaign:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /milestone/listByInfluencerAndCampaign
// body: { influencerId, campaignId }
exports.getMilestonesByInfluencerAndCampaign = async (req, res) => {
  const { influencerId, campaignId } = req.body;
  if (!influencerId || !campaignId) {
    return res.status(400).json({ message: 'influencerId and campaignId are required' });
  }

  try {
    const docs = await Milestone.find({
      'milestoneHistory.influencerId': influencerId,
      'milestoneHistory.campaignId': campaignId
    }).lean();

    const entries = docs.flatMap(doc =>
      doc.milestoneHistory
        .filter(e => e.influencerId === influencerId && e.campaignId === campaignId)
        .map(e => ({
          ...e,
          brandId: doc.brandId,
          walletBalance: doc.walletBalance
        }))
    );

    return res.status(200).json({
      message: 'Milestones fetched by influencer and campaign',
      milestones: entries
    });
  } catch (err) {
    console.error('Error in getMilestonesByInfluencerAndCampaign:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /milestone/listByInfluencer
// body: { influencerId }
exports.getMilestonesByInfluencer = async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId) {
    return res.status(400).json({ message: 'influencerId is required' });
  }

  try {
    const docs = await Milestone.find({ 'milestoneHistory.influencerId': influencerId }).lean();

    const entries = docs.flatMap(doc =>
      doc.milestoneHistory
        .filter(e => e.influencerId === influencerId)
        .map(e => ({
          ...e,
          brandId: doc.brandId,
          walletBalance: doc.walletBalance
        }))
    );

    return res.status(200).json({
      message: 'Milestones fetched by influencer',
      milestones: entries
    });
  } catch (err) {
    console.error('Error in getMilestonesByInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getMilestonesByBrand = async (req, res) => {
  const { brandId } = req.body;
  if (!brandId) {
    return res.status(400).json({ message: 'brandId is required' });
  }

  try {
    // 1) Load the brand’s Milestone doc
    const doc = await Milestone.findOne({ brandId }).lean();

    // 2) If none, return empty list
    if (!doc) {
      return res.status(200).json({
        message: 'No milestones found for this brand',
        milestones: []
      });
    }

    // 3) Flatten all history entries, tagging each with brandId and current balance
    const entries = doc.milestoneHistory.map(e => ({
      ...e,
      brandId: doc.brandId,
      walletBalance: doc.walletBalance
    }));

    return res.status(200).json({
      message: 'Milestones fetched by brand',
      milestones: entries
    });
  } catch (err) {
    console.error('Error in getMilestonesByBrand:', err);
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


exports.releaseMilestone = async (req, res) => {
  const { milestoneId, milestoneHistoryId } = req.body;
  if (!milestoneId || !milestoneHistoryId) {
    return res.status(400).json({ message: 'milestoneId and milestoneHistoryId are required.' });
  }

  try {
    const doc = await Milestone.findOne({ milestoneId });
    if (!doc) {
      return res.status(404).json({ message: 'Milestone not found.' });
    }

    // find the specific history entry
    const entry = doc.milestoneHistory.find(h => h.milestoneHistoryId === milestoneHistoryId);
    if (!entry) {
      return res.status(404).json({ message: 'Milestone history entry not found.' });
    }
    if (entry.released) {
      return res.status(400).json({ message: 'This milestone has already been released.' });
    }

    // deduct from brand wallet
    doc.walletBalance -= entry.amount;

    // mark as released
    entry.released = true;
    entry.releasedAt = new Date();

    await doc.save();

    return res.status(200).json({
      message: 'Milestone released successfully.',
      releasedAmount: entry.amount
    });
  } catch (err) {
    console.error('Error in releaseMilestone:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};


exports.getInfluencerPaidTotal = async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId) {
    return res.status(400).json({ message: 'influencerId is required.' });
  }
  try {
    const docs = await Milestone.find({ 'milestoneHistory.influencerId': influencerId });
    let totalPaid = 0;
    docs.forEach(d => {
      d.milestoneHistory
       .filter(e => e.influencerId === influencerId && e.released)
       .forEach(e => { totalPaid += e.amount; });
    });
    return res.json({ influencerId, totalPaid });
  } catch(err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};