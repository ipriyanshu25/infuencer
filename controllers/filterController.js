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
 *   - malePercentage:   <number>
 *   - femalePercentage: <number>
 *   - search:          <string>    // partial match on name/description
 *   - page:            <number>    // 1-based page number
 *   - limit:           <number>    // items per page
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
      femalePercentage,
      search,
      page = 1,
      limit = 10
    } = req.body || {};

    // Build base filter
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
    if ([0,1,2].includes(gender)) {
      filter.gender = gender;
    }
    if (countryId) {
      filter.countryId = countryId;
    }
    if (platformId) {
      filter.platformId = platformId;
    }
    if (typeof malePercentage === 'number') {
      filter['audienceBifurcation.malePercentage'] = { $gte: malePercentage };
    }
    if (typeof femalePercentage === 'number') {
      filter['audienceBifurcation.femalePercentage'] = { $gte: femalePercentage };
    }

    // Optional text search on name / bio / etc.
    if (typeof search === 'string' && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: regex },
        { bio: regex },
        // add other text fields here...
      ];
    }

    // Calculate pagination
    const pageNum = Math.max(1, parseInt(page, 10));
    const perPage = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (pageNum - 1) * perPage;

    // Execute queries in parallel
    const [totalCount, influencers] = await Promise.all([
      Influencer.countDocuments(filter),
      Influencer.find(filter)
                .skip(skip)
                .limit(perPage)
                .sort({ audienceRange: 1 })    // optional: sort by audienceRange
    ]);

    const totalPages = Math.ceil(totalCount / perPage);

    res.json({
      success: true,
      page: pageNum,
      perPage,
      totalPages,
      totalCount,
      count: influencers.length,
      data: influencers
    });
  } catch (err) {
    console.error('Error in getFilteredInfluencers:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
