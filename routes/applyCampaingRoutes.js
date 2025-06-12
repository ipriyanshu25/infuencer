const express = require('express');
const router  = express.Router();
const {
  applyToCampaign,
  getListByCampaign
} = require('../controllers/applyCampaignsController');
const { verifyToken } = require('../controllers/brandController');

// influencer applies to a campaign (requires valid token)
router.post('/campaign', verifyToken, applyToCampaign);

// list all influencers for a campaign (requires valid token)
router.post('/list',  verifyToken, getListByCampaign);

module.exports = router;
