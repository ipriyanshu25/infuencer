// routes/influencerRoutes.js
const express = require('express');
const router  = express.Router();
const {
  registerInfluencer,
  login,
  verifyToken,
  getList,
  getById,
getCampaignsByInfluencer,
requestOtpInfluencer,
verifyOtpInfluencer,
requestPasswordResetOtpInfluencer,
verifyPasswordResetOtpInfluencer,
resetPasswordInfluencer
} = require('../controllers/influencerController');

// Public endpoints:
router.post('/request-otp', requestOtpInfluencer);
router.post('/verify-otp', verifyOtpInfluencer);
router.post('/register', registerInfluencer);
router.post('/login',    login);
router.post('/get-campaign',getCampaignsByInfluencer);
router.post('/getlist',verifyToken,getList);
router.get('/getById', verifyToken,getById);

router.post('/sendOtp', requestPasswordResetOtpInfluencer);
router.post('/verifyOtp',   verifyPasswordResetOtpInfluencer);
router.post('/updatePassword', resetPasswordInfluencer);

module.exports = router;
