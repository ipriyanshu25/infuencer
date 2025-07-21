const Invitation = require('../models/invitation');
const Brand = require('../models/brand');
const Campaign = require('../models/campaign');

/**
 * Create a new Invitation
 * POST /api/invitations
 * Body: { brandId, influencerId, campaignId, isAccepted }
 */
exports.createInvitation = async (req, res) => {
  try {
    const { brandId, influencerId, campaignId, isAccepted = 0 } = req.body;

    // 1️⃣ check for existing invitation
    const existing = await Invitation.findOne({ influencerId, campaignId });
    if (existing) {
      return res
        .status(400)
        .json({ message: 'An invitation for this influencer and campaign already exists' });
    }

    // 2️⃣ fetch related Brand and Campaign
    const brand = await Brand.findOne({ brandId });
    const campaign = await Campaign.findOne({ campaignsId: campaignId });
    if (!brand)    return res.status(404).json({ message: 'Brand not found' });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    // 3️⃣ create & save
    const invitation = new Invitation({
      brandId,
      influencerId,
      campaignId,
      isAccepted,
      brand: {
        brandId: brand.brandId,
        name: brand.name,
        email: brand.email,
        phone: brand.phone
      },
      campaign: {
        campaignsId: campaign.campaignsId,
        brandName: campaign.brandName,
        productOrServiceName: campaign.productOrServiceName,
        description: campaign.description,
        timeline: campaign.timeline
      }
    });

    await invitation.save();
    res.status(201).json(invitation);
  } catch (err) {
    // if the unique-index fires, handle it here too
    if (err.code === 11000) {
      return res
        .status(400)
        .json({ message: 'Duplicate invitation not allowed' });
    }
    res.status(500).json({ message: err.message });
  }
};

/**
 * Get all Invitations
 * GET /api/invitations
 * Query: search, sortBy, page, limit
 */
exports.getInvitations = async (req, res) => {
  try {
    let {
      influencerId,
      search     = '',
      sortBy     = 'createdAt:desc',
      page       = 1,
      limit      = 10
    } = req.body;

    // influencerId is required
    if (!influencerId) {
      return res
        .status(400)
        .json({ message: 'influencerId is required' });
    }

    page  = parseInt(page,  10);
    limit = parseInt(limit, 10);

    // Build filter: only this influencer, plus optional text search
    const searchRegex = new RegExp(search, 'i');
    const filter = {
      influencerId,
      $or: [
        { 'brand.name': searchRegex },
        { 'campaign.productOrServiceName': searchRegex }
      ]
    };

    // Build sort
    const [field, order] = sortBy.split(':');
    const sort = { [field]: order === 'desc' ? -1 : 1 };

    // Query
    const total = await Invitation.countDocuments(filter);
    const invitations = await Invitation.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      data: invitations,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
;

/**
 * Accept Invitation
 * PATCH /api/invitations/accept
 * Body: { influencerId, campaignId }
 */
exports.acceptInvitation = async (req, res) => {
  try {
    const { invitationId } = req.body;

    // Find invitation by its ID
    const invitation = await Invitation.findOne({ invitationId });
    if (!invitation) {
      return res.status(404).json({ message: 'Invitation not found' });
    }

    // If already accepted, short-circuit
    if (invitation.isAccepted === 1) {
      return res.status(400).json({ message: 'Invitation already accepted' });
    }

    // Otherwise mark accepted and save
    invitation.isAccepted = 1;
    await invitation.save();

    res.json(invitation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

