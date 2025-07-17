// routes/brandRoutes.js

const express = require('express');
const router  = express.Router();
const { register, login,verifyToken,getBrandById,getAllBrands ,requestOtp,verifyOtp,requestPasswordResetOtp,verifyPasswordResetOtp,resetPassword} = require('../controllers/brandController');

// POST /brand/register → register a new brand
router.post('/register', register);
router.post('/requestOtp',requestOtp);
router.post('/verifyOtp',verifyOtp);

router.post('/brand/password/reset/request', requestPasswordResetOtp);
router.post('/brand/password/reset/verify',verifyPasswordResetOtp);
router.post('/brand/password/reset/complete',resetPassword);

// POST /brand/login → login an existing brand
router.post('/login', login);
router.get(
  '/',
  verifyToken,
  getBrandById
);
router.post(
  '/getAll',
  verifyToken,
  getAllBrands
);

module.exports = router;
  