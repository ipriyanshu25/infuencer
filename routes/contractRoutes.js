// routes/contractRoutes.js
const express = require('express');
const router  = express.Router();
const { sendOrGenerateContract ,getContract,viewContractPdf,acceptContract} = require('../controllers/contractController');

// GET /country → returns all countries
router.post('/sendContract', sendOrGenerateContract);
router.post('/getContract', getContract);
router.post('/view', viewContractPdf);
router.post('/accept', acceptContract);
module.exports = router;

