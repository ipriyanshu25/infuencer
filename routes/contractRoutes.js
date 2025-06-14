// routes/contractRoutes.js
const express = require('express');
const router  = express.Router();
const { sendOrGenerateContract ,getContract,viewContractPdf} = require('../controllers/contractController');

// GET /country → returns all countries
router.post('/sendContract', sendOrGenerateContract);
router.post('/getContract', getContract);
router.post('/view', viewContractPdf);
module.exports = router;

