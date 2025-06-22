// controllers/subscriptionPlanController.js
const SubscriptionPlan = require('../models/subscription');
const Brand            = require('../models/brand');
const Influencer       = require('../models/influencer');


// POST /subscription-plans
// body: { role, name, monthlyCost, features }
exports.createPlan = async (req, res) => {
  const { role, name, monthlyCost, features } = req.body;
  if (!role || !name || monthlyCost == null) {
    return res.status(400).json({ message: 'role, name and monthlyCost are required' });
  }
  try {
    const plan = new SubscriptionPlan({ role, name, monthlyCost, features });
    await plan.save();
    res.status(201).json({ message: 'Subscription plan created', plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /subscription-plans/list
// body: { role? }
// → returns all plans, optionally filtered by role
exports.getPlans = async (req, res) => {
  const { role } = req.body;
  const filter = role ? { role } : {};
  try {
    const plans = await SubscriptionPlan.find(filter).sort({ monthlyCost: 1 }).lean();
    res.status(200).json({ message: 'Plans retrieved', plans });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// GET /subscription-plans?id=<planId>
exports.getPlanById = async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ message: 'Query param id is required' });
  }
  try {
    const plan = await SubscriptionPlan.findOne({ planId: id }).lean();
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    res.status(200).json({ message: 'Plan retrieved', plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /subscription-plans/update
// body: { id: planId, ...fieldsToUpdate }
exports.updatePlan = async (req, res) => {
  const { id, ...updates } = req.body;
  if (!id) {
    return res.status(400).json({ message: 'Plan id is required' });
  }
  try {
    const plan = await SubscriptionPlan.findOneAndUpdate(
      { planId: id },
      updates,
      { new: true, runValidators: true }
    ).lean();
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    res.status(200).json({ message: 'Plan updated', plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /subscription-plans/delete
// body: { id: planId }
exports.deletePlan = async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ message: 'Plan id is required' });
  }
  try {
    const plan = await SubscriptionPlan.findOneAndDelete({ planId: id });
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    res.status(200).json({ message: 'Plan deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.assignPlan = async (req, res) => {
  const { userType, userId, planId, durationMonths } = req.body;
  if (!userType || !userId || !planId) {
    return res
      .status(400)
      .json({ message: 'userType, userId & planId are required' });
  }

  // 1) pick the right model
  const Model = userType === 'Brand' ? Brand : Influencer;

  // 2) lookup plan
  const plan = await SubscriptionPlan.findOne({ planId });
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  // 3) compute expiration date
  let expiresAt = null;
  if (durationMonths != null) {
    expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + Number(durationMonths));
  }

  // 4) build feature‐quota snapshot
  //    only numeric values are treated as quotas
  const featureSnapshot = plan.features.map(f => ({
    key:   f.key,
    limit: typeof f.value === 'number' ? f.value : 0,
    used:  0
  }));

  // 5) prepare the update
  const update = {
    'subscription.planId':     planId,
    'subscription.startedAt':  new Date(),
    'subscription.expiresAt':  expiresAt,
    'subscription.features':   featureSnapshot
  };

  // 6) apply to the chosen user
  const query = userType === 'Brand'
    ? { brandId: userId }
    : { influencerId: userId };

  const updated = await Model.findOneAndUpdate(query, update, {
    new: true,
    runValidators: true
  });

  if (!updated) {
    return res
      .status(404)
      .json({ message: `${userType} with ID ${userId} not found` });
  }

  // 7) respond
  return res.json({
    message:      `${userType} successfully subscribed to "${plan.name}"`,
    subscription: updated.subscription
  });
};

exports.getMyPlan = async (req, res) => {
  const { userType, userId } = req.body;
  if (!userType || !userId) {
    return res.status(400).json({ message: 'userType & userId required' });
  }
  const Model = userType === 'Brand' ? Brand : Influencer;
  const user = await Model.findOne(
    userType === 'Brand' ? { brandId: userId } : { influencerId: userId }
  ).populate('subscription.planId');
  if (!user) return res.status(404).json({ message: `${userType} not found` });

  return res.json({
    message: 'Current subscription fetched',
    plan: user.subscription.planId,
    startedAt: user.subscription.startedAt,
    expiresAt: user.subscription.expiresAt
  });
};