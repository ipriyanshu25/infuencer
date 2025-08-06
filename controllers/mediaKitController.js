/* ────────────────────────────────────────────────────────────
   models
────────────────────────────────────────────────────────────── */
const MediaKit   = require('../models/mediaKit');
const Influencer = require('../models/influencer');
const Country    = require('../models/country');
const Audience   = require('../models/audienceRange');

/* ────────────────────────────────────────────────────────────
   util: async error wrapper
────────────────────────────────────────────────────────────── */
const catchAsync = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ────────────────────────────────────────────────────────────
   util: duplicate-ID detector
────────────────────────────────────────────────────────────── */
function checkDuplicateIds(arr, keyName, errMsg) {
  if (!Array.isArray(arr)) return;              // nothing to check
  const seen = new Set();
  for (const item of arr) {
    const id = item?.[keyName];
    if (id == null) continue;                   // allow empty objects
    if (seen.has(id)) {
      const error = new Error(errMsg);
      error.statusCode = 400;
      throw error;
    }
    seen.add(id);
  }
}

/* ────────────────────────────────────────────────────────────
   POST /api/media-kit/influencer
────────────────────────────────────────────────────────────── */
exports.getInfluencerDetails = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  /* 1) fetch influencer (hide sensitive) */
  const influencer = await Influencer.findOne(
    { influencerId },
    { subscription: 0, paymentMethods: 0 }
  ).lean();

  if (!influencer)
    return res.status(404).json({ message: 'Influencer not found' });

  /* 2) seed empty MediaKit on first call */
  if (!(await MediaKit.exists({ influencerId }))) {
    await MediaKit.create({
      influencerId,
      name               : influencer.name            || '',
      profileImage       : influencer.profileImage    || '',
      bio                : influencer.bio             || '',
      platformName       : influencer.platformName    || '',
      categories         : influencer.categoryName    || [],
      audienceBifurcation: influencer.audienceBifurcation || {
        malePercentage: 0,
        femalePercentage: 0,
      },
    });
  }
  res.json(influencer);
});

/* ────────────────────────────────────────────────────────────
   POST /api/media-kit/list
────────────────────────────────────────────────────────────── */
exports.getAllMediaKits = catchAsync(async (_req, res) => {
  const kits = await MediaKit.find({}).lean();
  res.json(kits);
});

/* ────────────────────────────────────────────────────────────
   POST /api/media-kit/get
────────────────────────────────────────────────────────────── */
exports.getMediaKitById = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const kit = await MediaKit.findOne({ influencerId }).lean();
  if (!kit)
    return res.status(404).json({ message: 'MediaKit not found' });

  res.json(kit);
});

/* ────────────────────────────────────────────────────────────
   helpers: enrich arrays with missing names / ranges
────────────────────────────────────────────────────────────── */
async function enrichTopCountries(list = []) {
  const items = list.filter(Boolean);
  return Promise.all(
    items.map(async ({ countryId, name, percentage }) => {
      if (name) return { countryId, name, percentage };

      const doc = await Country.findById(countryId).lean();
      if (!doc) throw new Error(`Country not found for ID: ${countryId}`);
      return { countryId, name: doc.countryName, percentage };
    })
  );
}
async function enrichAgeBreakdown(list = []) {
  const items = list.filter(Boolean);
  return Promise.all(
    items.map(async ({ audienceRangeId, range, percentage }) => {
      if (range) return { audienceRangeId, range, percentage };

      const doc = await Audience.findById(audienceRangeId).lean();
      if (!doc) throw new Error(`Audience range not found for ID: ${audienceRangeId}`);
      return { audienceRangeId, range: doc.range, percentage };
    })
  );
}

/* ────────────────────────────────────────────────────────────
   POST /api/media-kit/create
────────────────────────────────────────────────────────────── */
exports.createMediaKit = catchAsync(async (req, res) => {
  const { influencerId, topCountries = [], ageBreakdown = [] } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  /* verify influencer */
  const influencer = await Influencer.findOne({ influencerId });
  if (!influencer)
    return res.status(404).json({ message: 'Influencer not found' });

  /* no duplicates allowed */
  checkDuplicateIds(topCountries, 'countryId',      'Duplicate countryId detected');
  checkDuplicateIds(ageBreakdown, 'audienceRangeId','Duplicate audienceRangeId detected');

  /* no second kit */
  if (await MediaKit.exists({ influencerId }))
    return res.status(409).json({ message: 'MediaKit already exists' });

  /* enrich + compose */
  const kitData = {
    ...req.body,
    influencerId,
    name         : req.body.name         ?? influencer.name,
    profileImage : req.body.profileImage ?? influencer.profileImage,
    bio          : req.body.bio          ?? influencer.bio,
    platformName : req.body.platformName ?? influencer.platformName,
    topCountries : await enrichTopCountries(topCountries),
    ageBreakdown : await enrichAgeBreakdown(ageBreakdown),
  };

  const kit = await MediaKit.create(kitData);
  res.status(201).json(kit);
});

/* ────────────────────────────────────────────────────────────
   POST /api/media-kit/update
────────────────────────────────────────────────────────────── */
exports.updateMediaKit = catchAsync(async (req, res) => {
  const { influencerId, topCountries, ageBreakdown, ...update } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  /* duplicate checks on provided arrays */
  if (topCountries)   checkDuplicateIds(topCountries, 'countryId',      'Duplicate countryId detected');
  if (ageBreakdown)   checkDuplicateIds(ageBreakdown,'audienceRangeId', 'Duplicate audienceRangeId detected');

  /* enrich if arrays supplied */
  if (topCountries)  update.topCountries  = await enrichTopCountries(topCountries);
  if (ageBreakdown)  update.ageBreakdown  = await enrichAgeBreakdown(ageBreakdown);

  const kit = await MediaKit.findOneAndUpdate(
    { influencerId },
    update,
    { new: true, upsert: true, runValidators: true }
  );

  res.json(kit);
});
