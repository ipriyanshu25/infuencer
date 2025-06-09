// routes/influencerRoutes.js
const express = require('express');
const router  = express.Router();
const {
  register,
  login,
  verifyToken,
  getProfile,
  getList,
  getById
} = require('../controllers/influencerController');

// Public endpoints:
router.post('/register', register);
router.post('/login',    login);
router.post('/getlist',verifyToken,getList);
router.get('/getById', verifyToken,getById);
// Protected endpoint: GET /influencer/me
router.get(
  '/me',                // <— this is the “/me” path
  verifyToken,          // <— middleware that checks & decodes the JWT
  getProfile            // <— controller method that returns the influencer’s data
);

module.exports = router;
