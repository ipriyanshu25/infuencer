// controllers/filterController.js
const Influencer = require('../models/influencer');

/**
 * POST /api/influencers/getlist
 * Body (all fields optional):
 *   - categories:      [<InterestId>, …]
 *   - audienceRange:   <string>
 *   - ageGroup:        <string>
 *   - gender:          0|1|2
 *   - countryId:       <CountryId>
 *   - platformId:      <PlatformId>
 *   - malePercentage:   <number>   // returns influencers with malePercentage ≥ this
 *   - femalePercentage: <number>   // returns influencers with femalePercentage ≥ this
 */
exports.getFilteredInfluencers = async (req, res) => {
  try {
    const {
      categories,
      audienceRange,
      ageGroup,
      gender,
      countryId,
      platformId,
      malePercentage,
      femalePercentage
    } = req.body || {};

    // Start with no filter (finds all if none added)
    const filter = {};

    if (Array.isArray(categories) && categories.length) {
      filter.categories = { $in: categories };
    }
    if (typeof audienceRange === 'string') {
      filter.audienceRange = audienceRange;
    }
    if (typeof ageGroup === 'string') {
      filter.audienceAgeRange = ageGroup;
    }
    if (gender === 0 || gender === 1 || gender === 2) {
      filter.gender = gender;
    }
    if (countryId) {
      filter.countryId = countryId;
    }
    if (platformId) {
      filter.platformId = platformId;
    }

    // Threshold filters on audience bifurcation
    if (typeof malePercentage === 'number') {
      filter['audienceBifurcation.malePercentage'] = { $gte: malePercentage };
    }
    if (typeof femalePercentage === 'number') {
      filter['audienceBifurcation.femalePercentage'] = { $gte: femalePercentage };
    }

    const influencers = await Influencer.find(filter);
    res.json({ success: true, count: influencers.length, data: influencers });
  } catch (err) {
    console.error('Error in getFilteredInfluencers:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
