// routes/subscriptionPlanRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/subscriptionController');

router.post('/list', ctrl.getPlans);

router.get('/getById', ctrl.getPlanById);

router.post('/create', ctrl.createPlan);

router.post('/update', ctrl.updatePlan);

router.post('/delete', ctrl.deletePlan);

router.post('/assign', ctrl.assignPlan);

router.post('/me', ctrl.getMyPlan);

module.exports = router;
