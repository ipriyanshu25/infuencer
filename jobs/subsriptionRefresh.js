// // jobs/subscriptionRefresh.js
// const cron = require('node-cron');

// // Models (assumes mongoose connection is initialized in app.js)
// const SubscriptionPlan = require('../models/subscriptionPlan');
// const Brand            = require('../models/brand');
// const Influencer       = require('../models/influencer');

// /**
//  * Core logic to refresh subscriptions:
//  * - Auto-renew free plans (autoRenew=true)
//  * - Expire paid plans
//  */
// async function refreshSubscriptions() {
//   const now = new Date();
//   console.log(`🔄 subscriptionRefresh running at ${now.toISOString()}`);

//   // 1) Fetch active autoRenew plans
//   const plans = await SubscriptionPlan.find({ autoRenew: true, status: 'active' })
//     .select('planId durationDays')
//     .lean();

//   const autoIds = plans.map(p => p.planId);
//   const durationMap = Object.fromEntries(plans.map(p => [p.planId, p.durationDays]));

//   // 2) Process Brands & Influencers
//   for (const [Model, idField] of [[Brand, 'brandId'], [Influencer, 'influencerId']]) {
//     // A) Auto-renew free subscriptions
//     const renewUsers = await Model.find({
//       'subscription.planId':   { $in: autoIds },
//       'subscription.expiresAt': { $lte: now }
//     });
//     for (const user of renewUsers) {
//       const days = durationMap[user.subscription.planId] || 30;
//       user.subscription.startedAt = now;
//       user.subscription.expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
//       user.subscriptionExpired = false;
//       await user.save();
//       console.log(`🔁 Auto-renewed ${Model.modelName} ${user[idField]} until ${user.subscription.expiresAt.toISOString()}`);
//     }

//     // B) Expire paid subscriptions
//     const expireUsers = await Model.find({
//       'subscription.planId':   { $nin: autoIds },
//       'subscription.expiresAt': { $lte: now },
//       subscriptionExpired:      { $ne: true }
//     });
//     for (const user of expireUsers) {
//       user.subscriptionExpired = true;
//       await user.save();
//       console.log(`⏰ Expired ${Model.modelName} ${user[idField]} at ${now.toISOString()}`);
//     }
//   }
// }

// // Schedule every minute to handle expiries precisely
// cron.schedule('* * * * *', () => {
//   refreshSubscriptions().catch(err => console.error('Subscription refresh error:', err));
// }, { timezone: 'Asia/Kolkata' });

// module.exports = { refreshSubscriptions };



const cron = require('node-cron');
const SubscriptionPlan = require('../models/subscription');
const Brand            = require('../models/brand');
const Influencer       = require('../models/influencer');

/**
 * Core logic to refresh subscriptions:
 * - Auto-renew free plans every 5 minutes
 * - Expire paid plans
 */
async function refreshSubscriptions() {
  const now = new Date();
  console.log(`🔄 subscriptionRefresh running at ${now.toISOString()}`);

  // 1) Fetch active autoRenew plans
  const autoPlans = await SubscriptionPlan.find({ autoRenew: true, status: 'active' })
    .select('planId')
    .lean();
  const autoIds = autoPlans.map(p => p.planId);

  // 2) Process Brands & Influencers
  for (const [Model, idField] of [[Brand, 'brandId'], [Influencer, 'influencerId']]) {
    // A) Auto-renew free subscriptions after 5 minutes
    const renewUsers = await Model.find({
      'subscription.planId':   { $in: autoIds },
      'subscription.expiresAt': { $lte: now }
    });
    for (const user of renewUsers) {
      const expire = new Date(now.getTime() + 5 * 60 * 1000);
      user.subscription.startedAt = now;
      user.subscription.expiresAt = expire;
      user.subscriptionExpired = false;
      await user.save();
      console.log(`🔁 Auto-renewed ${Model.modelName} ${user[idField]} until ${expire.toISOString()}`);
    }

    // B) Expire paid subscriptions (autoRenew=false)
    const expireUsers = await Model.find({
      'subscription.planId':   { $nin: autoIds },
      'subscription.expiresAt': { $lte: now },
      subscriptionExpired:      { $ne: true }
    });
    for (const user of expireUsers) {
      user.subscriptionExpired = true;
      await user.save();
      console.log(`⏰ Expired ${Model.modelName} ${user[idField]} at ${now.toISOString()}`);
    }
  }
}

// Schedule every minute to handle expiries precisely
cron.schedule('* * * * *', () => {
  refreshSubscriptions().catch(err => console.error('Subscription refresh error:', err));
}, { timezone: 'Asia/Kolkata' });

module.exports = { refreshSubscriptions };
