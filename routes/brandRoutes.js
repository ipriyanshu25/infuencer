// routes/brandRoutes.js

const express = require('express');
const router  = express.Router();
const { register, login,verifyToken,getBrandById,getAllBrands ,requestOtp,verifyOtp} = require('../controllers/brandController');

// POST /brand/register → register a new brand
router.post('/register', register);
router.post('/requestOtp',requestOtp);
router.post('/verifyOtp',verifyOtp);

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
  