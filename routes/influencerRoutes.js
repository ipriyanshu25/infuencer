// routes/influencerRoutes.js
const express = require('express');
const router  = express.Router();
const {
  register,
  login,
  verifyToken,
  getProfile
} = require('../controllers/influencerController');

// Public endpoints:
router.post('/register', register);
router.post('/login',    login);

// Protected endpoint: GET /influencer/me
router.get(
  '/me',                // <— this is the “/me” path
  verifyToken,          // <— middleware that checks & decodes the JWT
  getProfile            // <— controller method that returns the influencer’s data
);

module.exports = router;
