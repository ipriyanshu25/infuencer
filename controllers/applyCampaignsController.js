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
  const {
    campaignId,
    page = 1,
    limit = 10,
    search,
    sortField,
    sortOrder = 0
  } = req.body;

  if (!campaignId) {
    return res.status(400).json({ message: 'campaignId is required' });
  }

  try {
    const record = await ApplyCampaing.findOne({ campaignId });
    if (!record) {
      return res.status(200).json({
        meta: { total: 0, page, limit, totalPages: 0 },
        applicantCount: 0,
        isAssignedCampaign: 0,
        influencers: []
      });
    }

    const influencerIds = record.applicants.map(a => a.influencerId);
    const filter = { influencerId: { $in: influencerIds } };

    if (search && search.trim()) {
      filter.name = { $regex: search.trim(), $options: 'i' };
    }

    const total = await Influencer.countDocuments(filter);
    let query = Influencer.find(filter).select('-password -__v');

    if (sortField) {
      const order = sortOrder === 1 ? -1 : 1;
      query = query.sort({ [sortField]: order });
    }

    const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
    query = query.skip(skip).limit(Math.max(1, limit));

    const influencers = await query.exec();
    const totalPages = Math.ceil(total / limit);
    const applicantCount = record.applicants.length;

    const approvedId = record.approved && record.approved.length > 0
      ? record.approved[0].influencerId
      : null;
    const annotated = influencers.map(i => ({
      ...i.toObject(),
      isAssigned: i.influencerId === approvedId ? 1 : 0
    }));
    const isAssignedCampaign = approvedId ? 1 : 0;

    return res.status(200).json({
      meta: { total, page: Number(page), limit: Number(limit), totalPages },
      applicantCount,
      isAssignedCampaign,
      influencers: annotated
    });
  } catch (err) {
    console.error('Error in getListByCampaign:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


exports.approveInfluencer = async (req, res) => {
  const { campaignId, influencerId } = req.body;
  if (!campaignId || !influencerId) {
    return res.status(400).json({ message: 'Both campaignId and influencerId are required' });
  }

  try {
    // 1) Fetch application record
    const record = await ApplyCampaing.findOne({ campaignId });
    if (!record) {
      return res.status(404).json({ message: 'No applications found for this campaign' });
    }

    // 2) Check influencer applied
    const applicant = record.applicants.find(a => a.influencerId === influencerId);
    if (!applicant) {
      return res.status(400).json({ message: 'Influencer did not apply for this campaign' });
    }

    // 3) Ensure only one approval
    if (record.approved && record.approved.length > 0) {
      return res.status(400).json({ message: 'An influencer is already approved for this campaign' });
    }

    // 4) Approve influencer
    record.approved = [{ influencerId: applicant.influencerId, name: applicant.name }];
    await record.save();

    return res.status(200).json({
      message: 'Influencer approved successfully',
      campaignId,
      approved: record.approved[0]
    });
  } catch (err) {
    console.error('Error in approveInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};