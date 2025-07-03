// routes/influencerRoutes.js
const express = require('express');
const router = express.Router();
const {
  register,
  login,
  verifyToken,

  getById,

} = require('../controllers/influencerController');

// Public endpoints:
router.post('/register', register);
router.post('/login', login);
router.get('/getById', verifyToken, getById);


module.exports = router;
