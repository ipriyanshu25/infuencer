// controllers/applyCampaingsController.js

const ApplyCampaing = require('../models/applyCampaign');
const Campaign = require('../models/campaign');
const Influencer = require('../models/influencer');
const Contract = require('../models/contract');


exports.applyToCampaign = async (req, res) => {
  const { campaignId, influencerId } = req.body;
  if (!campaignId || !influencerId) {
    return res.status(400).json({ message: 'Both campaignId and influencerId are required' });
  }

  try {
    // ── 0) Load influencer & quota feature ────────────────────────
    const inf = await Influencer.findOne({ influencerId });
    if (!inf) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    // look up the “apply_to_campaigns_quota” feature slot
    const applyFeature = inf.subscription.features.find(f => f.key === 'apply_to_campaigns_quota');
    if (!applyFeature) {
      return res.status(403).json({
        message: 'Your subscription plan does not permit campaign applications. Please upgrade.'
      });
    }

    // if they’ve already used up their quota
    if (applyFeature.limit > 0 && applyFeature.used >= applyFeature.limit) {
      return res.status(403).json({
        message: `Application limit reached (${applyFeature.limit}). Please upgrade your plan to apply more.`
      });
    }

    // bump their usage
    applyFeature.used += 1;
    await inf.save();


    // ── 1) record the application ──────────────────────────────────
    const name = inf.name; // we already have it
    let record = await ApplyCampaing.findOne({ campaignId });
    if (!record) {
      record = new ApplyCampaing({
        campaignId,
        applicants: [{ influencerId, name }]
      });
    } else {
      if (record.applicants.some(a => a.influencerId === influencerId)) {
        return res.status(400).json({ message: 'You have already applied to this campaign' });
      }
      record.applicants.push({ influencerId, name });
    }
    await record.save();

    // ── 2) sync applicantCount back to Campaign ───────────────────
    const applicantCount = record.applicants.length;
    await Campaign.findOneAndUpdate(
      { campaignsId: campaignId },
      { applicantCount }
    );

    // ── 3) respond with remaining quota ───────────────────────────
    return res.status(200).json({
      message: 'Application recorded',
      campaignId,
      applicantCount,
      applicationsRemaining: applyFeature.limit - applyFeature.used,
      hasApplied: 1        // ← new flag
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
    // 1) Load the application record
    const record = await ApplyCampaing.findOne({ campaignId });
    if (!record) {
      return res.status(200).json({
        meta: { total: 0, page, limit, totalPages: 0 },
        applicantCount: 0,
        isAccepted: 0,
        isContracted: 0,
        contractId: null,
        influencers: []
      });
    }

    // 2) Build filter for all applied influencerIds
    const influencerIds = record.applicants.map(a => a.influencerId);
    const filter = { influencerId: { $in: influencerIds } };

    // 3) Optional name search
    if (search?.trim()) {
      filter.name = { $regex: search.trim(), $options: 'i' };
    }

    // 4) Pagination + total count
    const total = await Influencer.countDocuments(filter);
    let query = Influencer.find(filter).select('-password -__v');
    if (sortField) {
      const dir = sortOrder === 1 ? -1 : 1;
      query = query.sort({ [sortField]: dir });
    }
    const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
    query = query.skip(skip).limit(Math.max(1, limit));
    const influencers = await query.exec();

    // 5) Determine approved influencer
    const approvedId = record.approved?.[0]?.influencerId || null;

    // 6) Lookup the single Contract for this campaign (if any)
    const contract = await Contract.findOne({ campaignId }).lean();
    const isContracted = contract ? 1 : 0;
    const contractId = contract ? contract.contractId : null;
    const isAccepted = contract && contract.isAccepted === 1 ? 1 : 0;

    // 7) Annotate each influencer
    const annotated = influencers.map(inf => {
      const isAssigned = inf.influencerId === approvedId ? 1 : 0;
      const isAccepted = isAssigned && contract?.isAccepted === 1 ? 1 : 0;
      return {
        ...inf.toObject(),
        isAssigned,
        isAccepted
      };
    });


    // 8) Build pagination meta
    const totalPages = Math.ceil(total / limit);
    const applicantCount = record.applicants.length;

    // 9) Return response
    return res.status(200).json({
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages
      },
      applicantCount,
      isAccepted,
      isContracted,
      contractId,
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