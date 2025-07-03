const express = require('express');
const router = express.Router();
const {login,getAllBrands} = require('../controllers/adminController');  

// POST /admin/create
router.post('/login', login);    
router.post('/brand/getlist', getAllBrands);
module.exports = router;