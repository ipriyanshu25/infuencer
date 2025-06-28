const SubscriptionPlan = require('../models/subscription');

/** Return the free-plan record for a given role. */
exports.getFreePlan = role =>
  SubscriptionPlan.findOne({
    role,
    name: role === 'Brand' ? 'free' : 'basic'
  });

/** Compute expiry from now + plan.durationMins */
exports.computeExpiry = plan =>
  new Date(Date.now() + (plan.durationMins || 43200) * 60 * 1000);  //43200 mins = 30 days
