// controllers/dashboardController.js
const Brand      = require('../models/brand');
const Campaign = require('../models/campaign');
const Influencer = require('../models/influencer');
const Milestone  = require('../models/milestone');

exports.getDashboard=async (req, res)=> {
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

exports.getDashboardInf = async (req, res) => {
  try {
    // pull raw value from body and normalize
    let { influencerId } = req.body;
    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required in body' });
    }
    influencerId = String(influencerId).trim();

    // ensure the caller is that influencer
    const tokenInfId = String(req.influencer?.influencerId || '').trim();
    if (!tokenInfId || tokenInfId !== influencerId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // now fetch all campaigns for this influencer
    const campaigns = await Campaign.find({ influencerId }).lean();

    const now = new Date();
    // next payout cycle: first day of next month (adjust as needed)
    const nextPayoutDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    let activeCampaigns = 0;
    let pendingApprovals = 0;
    let totalEarnings = 0;
    let upcomingPayouts = 0;

    campaigns.forEach(c => {
      if (c.timeline?.startDate <= now && now <= c.timeline?.endDate) {
        activeCampaigns++;
      }
      if (c.isContracted === true && c.isAccepted === false) {
        pendingApprovals++;
      }
      (c.milestones || []).forEach(m => {
        if (m.released === true) {
          totalEarnings += m.amount || 0;
        }
        if (
          m.accepted === true &&
          m.released === false &&
          m.dueDate &&
          new Date(m.dueDate) <= nextPayoutDate
        ) {
          upcomingPayouts += m.amount || 0;
        }
      });
    });

    // format money (USD); adjust locale/currency if needed
    const fmt = amt =>
      Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
      }).format(amt);

    return res.status(200).json({
      influencerId,
      activeCampaigns,
      pendingApprovals,
      totalEarnings: fmt(totalEarnings),
      upcomingPayouts: fmt(upcomingPayouts)
    });
  } catch (err) {
    console.error('Error in getDashboardInf:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};