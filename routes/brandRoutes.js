// routes/brandRoutes.js

const express = require('express');
const router  = express.Router();
const { register, login,verifyToken,getBrandById,getAllBrands } = require('../controllers/brandController');

// POST /brand/register → register a new brand
router.post('/register', register);

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
  