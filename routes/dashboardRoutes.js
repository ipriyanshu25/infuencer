// routes/dashboard.js
const express = require('express');
const router  = express.Router();
const { getDashboard,getDashboardInf } = require('../controllers/dashboardController');

router.post('/brand', getDashboard);

router.post('/influencer', getDashboardInf);

module.exports = router;
