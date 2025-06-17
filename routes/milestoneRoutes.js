const express = require('express');
const router  = express.Router();
const {
  createMilestone,
  getMilestonesByCampaign,
  getWalletBalance
} = require('../controllers/milestoneController');

// create a new milestone
router.post('/create', createMilestone);

// list all milestones for a campaign
router.post('/list', getMilestonesByCampaign);

// get total wallet‐balance for a brand
router.post('/balance', getWalletBalance);

module.exports = router;
