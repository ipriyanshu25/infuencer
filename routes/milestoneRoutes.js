const express = require('express');
const router  = express.Router();
const {
  createMilestone,
  getMilestonesByCampaign,
  getWalletBalance,
  getMilestonesByInfluencerAndCampaign,
  getMilestonesByInfluencer,
  getMilestonesByBrand
} = require('../controllers/milestoneController');

// create a new milestone
router.post('/create', createMilestone);

// list all milestones for a campaign
router.post('/byCampaign', getMilestonesByCampaign);

// get total wallet‐balance for a brand
router.post('/balance', getWalletBalance);

router.post('/getMilestome',getMilestonesByInfluencerAndCampaign);

router.post('/byInfluencer',getMilestonesByInfluencer);

router.post('/byBrand', controller.getMilestonesByBrand);

module.exports = router;
