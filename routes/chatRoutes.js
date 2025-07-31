// routes/chat.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/chatController');

router.post('/room',    ctrl.createRoom);
router.post('/rooms',   ctrl.getRooms);
router.post('/history', ctrl.getMessages);
router.post('/message', ctrl.postMessage);

module.exports = router;