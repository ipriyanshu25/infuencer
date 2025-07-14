// routes/contactRoutes.js

const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

// Create a new contact message
// POST /api/contact/create
router.post('/send', contactController.sendContact);
router.post('/getList', contactController.getAllContacts);


module.exports = router;
