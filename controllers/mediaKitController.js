const MediaKit   = require('../models/mediaKit');
const Influencer = require('../models/influencer');
const Country    = require('../models/country');
const Audience = require('../models/audienceRange');

/* helper to avoid repeating try/catch */
const catchAsync = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ──────────────────────────────────────────────────────────────
   POST /api/media-kit/influencer
   BODY: { influencerId }
──────────────────────────────────────────────────────────────── */
exports.getInfluencerDetails = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const influencer = await Influencer.findOne(
    { influencerId },
    { subscription: 0, paymentMethods: 0 }
  ).lean();

  if (!influencer)
    return res.status(404).json({ message: 'Influencer not found' });

  res.json(influencer);
});

/* ──────────────────────────────────────────────────────────────
   POST /api/media-kit/list
──────────────────────────────────────────────────────────────── */
exports.getAllMediaKits = catchAsync(async (_req, res) => {
  const kits = await MediaKit.find({}).lean();
  res.json(kits);
});

/* ──────────────────────────────────────────────────────────────
   POST /api/media-kit/get
   BODY: { influencerId }
──────────────────────────────────────────────────────────────── */
exports.getMediaKitById = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const kit = await MediaKit.findOne({ influencerId }).lean();
  if (!kit)
    return res.status(404).json({ message: 'MediaKit not found' });

  res.json(kit);
});

/* ──────────────────────────────────────────────────────────────
   helpers to enrich topCountries / ageBreakdown payloads
──────────────────────────────────────────────────────────────── */
async function enrichTopCountries(arr = []) {
  return Promise.all(
    arr.map(async item => {
      if (item.name) return item;          // already complete

      // fetch country name by ID
      const doc = await Country.findById(item.countryId).lean();
      if (!doc)
        throw new Error(`Country not found for ID ${item.countryId}`);

      return { ...item, name: doc.countryName };
    })
  );
}

async function enrichAgeBreakdown(arr = []) {
  return Promise.all(
    arr.map(async item => {
      if (item.range) return item;         // already complete

      const doc = await Audience.findById(item.audienceRangeId).lean();
      if (!doc)
        throw new Error(`Audience range not found for ID ${item.audienceRangeId}`);

      return { ...item, range: doc.range };
    })
  );
}

/* ──────────────────────────────────────────────────────────────
   POST /api/media-kit/create
   BODY: full payload – must include influencerId
──────────────────────────────────────────────────────────────── */
exports.createMediaKit = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const influencer = await Influencer.findOne({ influencerId });
  if (!influencer)
    return res.status(404).json({ message: 'Influencer not found' });

  if (await MediaKit.exists({ influencerId }))
    return res.status(409).json({ message: 'MediaKit already exists' });

  /* fill blanks from Influencer doc */
  const kitData = {
    ...req.body,
    name         : req.body.name         ?? influencer.name,
    profileImage : req.body.profileImage ?? influencer.profileImage,
    bio          : req.body.bio          ?? influencer.bio,
    platformName : req.body.platformName ?? influencer.platformName,
  };

  /* enrich embedded arrays (adds country name / range label) */
  kitData.topCountries = await enrichTopCountries(kitData.topCountries);
  kitData.ageBreakdown = await enrichAgeBreakdown(kitData.ageBreakdown);

  const kit = await MediaKit.create(kitData);   // schema validation
  res.status(201).json(kit);
});

/* ──────────────────────────────────────────────────────────────
   POST /api/media-kit/update
   BODY: { influencerId, ...fieldsToUpdate }
──────────────────────────────────────────────────────────────── */
exports.updateMediaKit = catchAsync(async (req, res) => {
  const { influencerId, topCountries, ageBreakdown, ...update } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  /* if these arrays are present we need to enrich them first */
  if (topCountries)  update.topCountries  = await enrichTopCountries(topCountries);
  if (ageBreakdown)  update.ageBreakdown  = await enrichAgeBreakdown(ageBreakdown);

  const kit = await MediaKit.findOneAndUpdate(
    { influencerId },
    update,
    { new: true, upsert: true, runValidators: true }
  );

  res.json(kit);
});
