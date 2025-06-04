// routes/brandRoutes.js

const express = require('express');
const router  = express.Router();
const { register, login,verifyToken,getBrandById } = require('../controllers/brandController');

// POST /brand/register → register a new brand
router.post('/register', register);

// POST /brand/login → login an existing brand
router.post('/login', login);
router.get(
  '/',
  verifyToken,
  getBrandById
);

module.exports = router;
