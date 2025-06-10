// routes/influencerRoutes.js
const express = require('express');
const router  = express.Router();
const {
  register,
  login,
  verifyToken,
  getList,
  getById,
  getActiveCampaignsByCategory
} = require('../controllers/influencerController');

// Public endpoints:
router.post('/register', register);
router.post('/login',    login);
router.post('/getlist',verifyToken,getList);
router.get('/getById', verifyToken,getById);


module.exports = router;
