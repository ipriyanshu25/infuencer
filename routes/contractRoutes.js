// routes/contractRoutes.js
const express = require('express');
const router  = express.Router();
const { sendOrGenerateContract ,getContract} = require('../controllers/contractController');

// GET /country → returns all countries
router.post('/sendContract', sendOrGenerateContract);
router.post('/getContract', getContract);
module.exports = router;

