// routes/dashboard.js
const express = require('express');
const router  = express.Router();
const { getDashboard } = require('../controllers/dashboardController');

router.post('/brand', getDashboard);

module.exports = router;
