// controllers/policyController.js

const Policy = require('../models/policy');

/**
 * Create a new policy
 * POST /api/policy/create
 * Body: { policyName, effectiveDate, sections }
 */
exports.createPolicy = async (req, res) => {
  try {
    const { policyName, effectiveDate, sections } = req.body;
    const existing = await Policy.findOne({ policyName });
    if (existing) {
      return res.status(400).json({ error: 'policyName already exists' });
    }
    const policy = new Policy({ policyName, effectiveDate, sections });
    await policy.save();
    return res.status(201).json(policy);
  } catch (err) {
    console.error('createPolicy error', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Update an existing policy
 * POST /api/policy/update
 * Body: { policyName, effectiveDate?, sections? }
 */
exports.updatePolicy = async (req, res) => {
  try {
    const { policyName, effectiveDate, sections } = req.body;
    const update = {};
    if (effectiveDate) update.effectiveDate = effectiveDate;
    if (sections)      update.sections = sections;
    const policy = await Policy.findOneAndUpdate(
      { policyName },
      { $set: update },
      { new: true }
    );
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    return res.json(policy);
  } catch (err) {
    console.error('updatePolicy error', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Delete a policy
 * POST /api/policy/delete
 * Body: { policyName }
 */
exports.deletePolicy = async (req, res) => {
  try {
    const { policyName } = req.body;
    const result = await Policy.findOneAndDelete({ policyName });
    if (!result) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    return res.json({ message: 'Policy deleted' });
  } catch (err) {
    console.error('deletePolicy error', err);
    return res.status(500).json({ error: 'Server error' });
  }
};


exports.getPolicy = async (req, res) => {
  try {
    const { policyName } = req.body;
    const policy = await Policy.findOne({ policyName });
    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    return res.json(policy);
  } catch (err) {
    console.error('getPolicy error', err);
    return res.status(500).json({ error: 'Server error' });
  }
};