const express = require('express');
const router = express.Router();
const {login,getAllBrands,getList} = require('../controllers/adminController');  

// POST /admin/create
router.post('/login', login);    
router.post('/brand/getlist', getAllBrands);
router.post('/influencer/getlist', getList);
module.exports = router;