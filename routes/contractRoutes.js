// routes/contractRoutes.js
const express = require('express');
const router  = express.Router();
const { sendContract ,getContract} = require('../controllers/contractController');

// GET /country → returns all countries
router.post('/sendContract', sendContract);
router.post('/getContract', getContract);
module.exports = router;

