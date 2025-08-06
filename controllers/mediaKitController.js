const MediaKit     = require('../models/mediaKit');
const Influencer   = require('../models/influencer');

/**
 * tiny helper so we don’t repeat try/catch everywhere
 * usage: catchAsync(fn) → (req,res,next)
 */
const catchAsync = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/* ------------------------------------------------------------------
   1)  GET /api/media-kit/influencer/:influencerId
       – return the data you ALREADY have in the Influencer collection
------------------------------------------------------------------- */
exports.getInfluencerDetails = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const influencer = await Influencer.findOne(
    { influencerId },
    { subscription: 0, paymentMethods: 0 }      //  <-- projection
  ).lean();

  if (!influencer)
    return res.status(404).json({ message: 'Influencer not found' });

  res.json(influencer);
});

/* ==============================================================
   POST /api/media-kit/list
   BODY: {}   (optional filter criteria could be added)
================================================================*/
exports.getAllMediaKits = catchAsync(async (_req, res) => {
  const kits = await MediaKit.find({});
  res.json(kits);
});

/* ==============================================================
   POST /api/media-kit/get
   BODY: { influencerId }
================================================================*/
exports.getMediaKitById = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const kit = await MediaKit.findOne({ influencerId });
  if (!kit)
    return res.status(404).json({ message: 'MediaKit not found' });

  res.json(kit);
});

/* ==============================================================
   POST /api/media-kit/create
   BODY: full MediaKit payload (must include influencerId)
================================================================*/
exports.createMediaKit = catchAsync(async (req, res) => {
  const { influencerId } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  // verify influencer exists
  const influencer = await Influencer.findOne({ influencerId });
  if (!influencer)
    return res.status(404).json({ message: 'Influencer not found' });

  // prevent duplicates
  const exists = await MediaKit.findOne({ influencerId });
  if (exists)
    return res.status(409).json({ message: 'MediaKit already exists' });

  // fallback-fill a few fields from Influencer when absent
  const kitData = {
    ...req.body,
    name:          req.body.name          ?? influencer.name,
    profileImage:  req.body.profileImage  ?? influencer.profileImage,
    bio:           req.body.bio           ?? influencer.bio,
    platformName:  req.body.platformName  ?? influencer.platformName,
    categories:    req.body.categories?.length
                     ? req.body.categories
                     : influencer.categoryName,          // string[]
    audienceBifurcation: req.body.audienceBifurcation ??
                         influencer.audienceBifurcation,
  };

  const kit = new MediaKit(kitData);
  await kit.save();
  res.status(201).json(kit);
});

/* ==============================================================
   POST /api/media-kit/update
   BODY: { influencerId, ...fieldsToUpdate }
   – upserts, so it also creates if one isn’t there yet
================================================================*/
exports.updateMediaKit = catchAsync(async (req, res) => {
  const { influencerId, ...update } = req.body;
  if (!influencerId)
    return res.status(400).json({ message: 'influencerId is required' });

  const kit = await MediaKit.findOneAndUpdate(
    { influencerId },
    update,
    { new: true, upsert: true, runValidators: true }
  );

  res.json(kit);
});