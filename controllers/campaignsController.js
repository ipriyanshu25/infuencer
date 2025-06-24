// controllers/campaignController.js

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const multer = require('multer');

const Campaign = require('../models/campaign');
const Brand = require('../models/brand');
const Interest = require('../models/interest');
const ApplyCampaign = require('../models/applyCampaign');
const Influencer = require('../models/influencer');
const Contract = require('../models/contract');
const SubscriptionPlan = require('../models/subscription');
const getFeature = require('../utils/getFeature');


// ===============================
//  Multer setup for two fields:
//   • "image"        → for image uploads (stored in `images` array)
//   • "creativeBreef" → for PDF/document uploads (stored in `creativeBrief` array)
// ===============================
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${baseName}_${timestamp}${ext}`);
  }
});

// Accept up to 10 images under 'image' and up to 10 docs under 'creativeBrief'
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB per file
}).fields([
  { name: 'image', maxCount: 10 },
  { name: 'creativeBrief', maxCount: 10 }
]);

// Helper to compute isActive from timeline
function computeIsActive(timeline) {
  if (!timeline || !timeline.endDate) {
    // If no endDate provided, default to active
    return 1;
  }
  const now = new Date();
  // If endDate is in the past, mark inactive (0). Otherwise active (1).
  return (timeline.endDate < now) ? 0 : 1;
}

// =======================================
//  CREATE CAMPAIGN (with isActive logic)
// =======================================
exports.createCampaign = (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer Error:', err);
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      console.error('Upload Error:', err);
      return res.status(500).json({ message: 'Error uploading files.' });
    }

    try {
      // 1) Pull & validate incoming fields
      let {
        brandId,
        productOrServiceName,
        description = '',
        targetAudience,
        interestId,
        goal,
        creativeBriefText,
        budget = 0,
        timeline,
        additionalNotes = ''
      } = req.body;

      if (!brandId) return res.status(400).json({ message: 'brandId is required.' });
      if (!productOrServiceName || !goal) {
        return res.status(400).json({ message: 'productOrServiceName and goal are required.' });
      }

      // 2) Load Brand & its current plan
      const brand = await Brand.findOne({ brandId });
      if (!brand) return res.status(404).json({ message: 'Brand not found.' });

      const plan = await SubscriptionPlan.findOne({ planId: brand.subscription.planId }).lean();
      if (!plan) {
        return res.status(500).json({ message: 'Subscription plan not found.' });
      }

      // 3) Enforce “live_campaigns_limit”
      // 3) Enforce “live_campaigns_limit” **per subscription cycle**
      const liveCap = getFeature(brand.subscription, 'live_campaigns_limit');
      const limit = liveCap ? liveCap.limit : 0;           // 0 → unlimited
      const used = liveCap ? liveCap.used : 0;
      if (limit > 0 && used >= limit) {
        return res.status(403).json({
          message: `You have reached this cycle’s campaign quota (${limit}). `
            + `It will reset on ${brand.subscription.expiresAt.toISOString()}.`
        });
      }

      // 4) Parse & normalize targetAudience JSON
      let audienceData = { age: { MinAge: 0, MaxAge: 0 }, gender: 2, location: '' };
      if (targetAudience) {
        let ta = targetAudience;
        if (typeof ta === 'string') {
          try { ta = JSON.parse(ta); }
          catch { return res.status(400).json({ message: 'Invalid JSON in targetAudience.' }); }
        }
        const { age, gender, location } = ta;
        if (age?.MinAge != null) audienceData.age.MinAge = Number(age.MinAge) || 0;
        if (age?.MaxAge != null) audienceData.age.MaxAge = Number(age.MaxAge) || 0;
        if ([0, 1, 2].includes(gender)) audienceData.gender = gender;
        if (typeof location === 'string') audienceData.location = location.trim();
      }

      // 5) Parse & validate interestId array
      let validIds = [], names = [];
      if (interestId) {
        let arr = interestId;
        if (typeof arr === 'string') {
          try { arr = JSON.parse(arr); }
          catch { return res.status(400).json({ message: 'Invalid JSON in interestId.' }); }
        }
        if (!Array.isArray(arr)) {
          return res.status(400).json({ message: 'interestId must be an array.' });
        }
        for (let id of arr) {
          if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: `Invalid interestId: ${id}` });
          }
          const doc = await Interest.findById(id);
          if (!doc) return res.status(404).json({ message: `Interest not found: ${id}` });
          validIds.push(doc._id);
          names.push(doc.name);
        }
      }

      // 6) Parse timeline JSON
      let tlData = {};
      if (timeline) {
        let tl = timeline;
        if (typeof tl === 'string') {
          try { tl = JSON.parse(tl); }
          catch { return res.status(400).json({ message: 'Invalid JSON in timeline.' }); }
        }
        if (tl.startDate) {
          const sd = new Date(tl.startDate);
          if (!isNaN(sd)) tlData.startDate = sd;
        }
        if (tl.endDate) {
          const ed = new Date(tl.endDate);
          if (!isNaN(ed)) tlData.endDate = ed;
        }
      }

      // 7) Compute isActive flag
      const isActiveFlag = computeIsActive(tlData);

      // 8) Gather uploaded file paths
      const images = (req.files.image || []).map(f => path.join('uploads', path.basename(f.path)));
      const creativePDFs = (req.files.creativeBrief || []).map(f => path.join('uploads', path.basename(f.path)));

      // 9) Build & save the new Campaign
      const newCampaign = new Campaign({
        brandId,
        brandName: brand.name,
        productOrServiceName,
        description,
        targetAudience: audienceData,
        interestId: validIds,
        interestName: names.join(','),
        goal,
        creativeBriefText,
        budget,
        timeline: tlData,
        images,
        creativeBrief: creativePDFs,
        additionalNotes,
        isActive: isActiveFlag
      });

      await newCampaign.save();

      if (limit > 0) {
        await Brand.updateOne(
          { brandId, 'subscription.features.key': 'live_campaigns_limit' },
          { $inc: { 'subscription.features.$.used': 1 } }
        );
      }
      return res.status(201).json({ message: 'Campaign created successfully.' });

    } catch (error) {
      console.error('Error in createCampaign:', error);
      return res.status(500).json({ message: 'Internal server error while creating campaign.' });
    }
  });
};

// ===============================
//  GET ALL CAMPAIGNS
// ===============================
exports.getAllCampaigns = async (req, res) => {
  try {
    const filter = {};
    if (req.query.brandId) {
      filter.brandId = req.query.brandId;
    }
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .populate('interestId', 'name');

    return res.json(campaigns);
  } catch (error) {
    console.error('Error in getAllCampaigns:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while fetching campaigns.' });
  }
};

// =======================================
//  GET A SINGLE CAMPAIGN BY campaignsId
// =======================================
exports.getCampaignById = async (req, res) => {
  try {
    const campaignsId = req.query.id;
    if (!campaignsId) {
      return res
        .status(400)
        .json({ message: 'Query parameter id (campaignsId) is required.' });
    }

    const campaign = await Campaign.findOne({ campaignsId }).populate('interestId', 'name');
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    return res.json(campaign);
  } catch (error) {
    console.error('Error in getCampaignById:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while fetching campaign.' });
  }
};

// =====================================
//  UPDATE CAMPAIGN (with isActive logic)
// =====================================
exports.updateCampaign = (req, res) => {
  upload(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      console.error('Multer Error:', err);
      return res.status(400).json({ message: err.message });
    } else if (err) {
      console.error('Unknown Upload Error:', err);
      return res.status(500).json({ message: 'Error uploading files.' });
    }

    try {
      const campaignsId = req.query.id;
      if (!campaignsId) {
        return res
          .status(400)
          .json({ message: 'Query parameter id (campaignsId) is required.' });
      }

      // Copy all fields from req.body
      const updates = { ...req.body };

      // Remove protected fields
      delete updates.brandId;
      delete updates.brandName;
      delete updates.campaignsId;
      delete updates.createdAt;

      // Parse and validate targetAudience if present
      if (updates.targetAudience) {
        let parsedTA = updates.targetAudience;
        if (typeof updates.targetAudience === 'string') {
          try {
            parsedTA = JSON.parse(updates.targetAudience);
          } catch {
            return res.status(400).json({ message: 'Invalid JSON in targetAudience.' });
          }
        }
        const { age, gender, location } = parsedTA;
        let audienceData = { age: { MinAge: 0, MaxAge: 0 }, gender: 2, location: '' };
        if (age && typeof age === 'object') {
          const { MinAge, MaxAge } = age;
          if (typeof MinAge === 'number') audienceData.age.MinAge = MinAge;
          if (typeof MaxAge === 'number') audienceData.age.MaxAge = MaxAge;
        }
        if (typeof gender === 'number' && [0, 1, 2].includes(gender)) {
          audienceData.gender = gender;
        }
        if (typeof location === 'string') {
          audienceData.location = location.trim();
        }
        updates.targetAudience = audienceData;
      }

      // Parse and validate interestId if present
      if (updates.interestId) {
        let parsedInterests = updates.interestId;
        if (typeof updates.interestId === 'string') {
          try {
            parsedInterests = JSON.parse(updates.interestId);
          } catch {
            return res.status(400).json({ message: 'Invalid JSON in interestId.' });
          }
        }
        if (!Array.isArray(parsedInterests)) {
          return res.status(400).json({ message: 'interestId must be an array.' });
        }
        let validInterestIds = [];
        let interestNames = [];
        for (const id of parsedInterests) {
          if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: `Invalid interestId: ${id}` });
          }
          const interestDoc = await Interest.findById(id);
          if (!interestDoc) {
            return res.status(404).json({ message: `Interest not found: ${id}` });
          }
          validInterestIds.push(interestDoc._id);
          interestNames.push(interestDoc.name);
        }
        updates.interestId = validInterestIds;
        updates.interestName = interestNames.join(',');
      }

      // Parse timeline if present
      if (updates.timeline) {
        let parsedTL = updates.timeline;
        if (typeof updates.timeline === 'string') {
          try {
            parsedTL = JSON.parse(updates.timeline);
          } catch {
            return res.status(400).json({ message: 'Invalid JSON in timeline.' });
          }
        }
        const { startDate, endDate } = parsedTL;
        let timelineData = {};
        if (startDate) {
          const sd = new Date(startDate);
          if (!isNaN(sd)) timelineData.startDate = sd;
        }
        if (endDate) {
          const ed = new Date(endDate);
          if (!isNaN(ed)) timelineData.endDate = ed;
        }
        updates.timeline = timelineData;

        // Recompute isActive based on new timeline
        updates.isActive = computeIsActive(timelineData);
      }

      // If new image files were uploaded, overwrite `images`
      if (Array.isArray(req.files['image']) && req.files['image'].length > 0) {
        updates.images = req.files['image'].map(file => {
          return path.join('uploads', path.basename(file.path));
        });
      }

      // If new PDF files were uploaded, overwrite `creativeBrief`
      if (Array.isArray(req.files['creativeBreef']) && req.files['creativeBreef'].length > 0) {
        updates.creativeBrief = req.files['creativeBreef'].map(file => {
          return path.join('uploads', path.basename(file.path));
        });
      }

      // Perform the update
      const updatedCampaign = await Campaign.findOneAndUpdate(
        { campaignsId },
        updates,
        {
          new: true,
          runValidators: true
        }
      ).populate('interestId', 'name');

      if (!updatedCampaign) {
        return res.status(404).json({ message: 'Campaign not found.' });
      }

      return res.json({
        message: 'Campaign updated successfully.',
        campaign: updatedCampaign
      });
    } catch (error) {
      console.error('Error in updateCampaign:', error);
      return res.status(500).json({ message: 'Internal server error while updating campaign.' });
    }
  });
};

// ================================
//  DELETE CAMPAIGN BY campaignsId
// ================================
exports.deleteCampaign = async (req, res) => {
  try {
    const campaignsId = req.query.id;
    if (!campaignsId) {
      return res.status(400).json({ message: 'Query parameter id (campaignsId) is required.' });
    }

    const deleted = await Campaign.findOneAndDelete({ campaignsId });
    if (!deleted) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    return res.json({ message: 'Campaign deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteCampaign:', error);
    return res.status(500).json({ message: 'Internal server error while deleting campaign.' });
  }
};

exports.getActiveCampaignsByBrand = async (req, res) => {
  try {
    const { brandId } = req.query;
    if (!brandId) {
      return res.status(400).json({ message: 'Query parameter brandId is required.' });
    }

    const campaigns = await Campaign.find({
      brandId,
      isActive: 1
    })
      .sort({ createdAt: -1 })
      .populate('interestId', 'name')
      .lean();    // ← returns plain JS objects, including `applicantCount`

    return res.json(campaigns);
  } catch (error) {
    console.error('Error in getActiveCampaignsByBrand:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while fetching active campaigns.' });
  }
};

exports.getPreviousCampaigns = async (req, res) => {
  try {
    const brandId = req.query.brandId;
    if (!brandId) {
      return res.status(400).json({ message: 'Query parameter brandId is required.' });
    }

    // Find campaigns where brandId matches and isActive = 1
    const campaigns = await Campaign.find({
      brandId: brandId,
      isActive: 0
    })
      .sort({ createdAt: -1 })
      .populate('interestId', 'name');

    return res.json(campaigns);
  } catch (error) {
    console.error('Error in getActiveCampaignsByBrand:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while fetching active campaigns.' });
  }
};


exports.getActiveCampaignsByCategory = async (req, res) => {
  const {
    categoryId,
    search,           // single search term
    page = 1,
    limit = 10
  } = req.body;

  if (!categoryId) {
    return res.status(400).json({ message: 'categoryId is required' });
  }
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    return res.status(400).json({ message: 'Invalid categoryId' });
  }

  // Base filter: must belong to this category and be active
  const filter = {
    interestId: categoryId,
    isActive: 1
  };


  if (search && String(search).trim()) {
    const term = String(search).trim();
    const orClauses = [
      { brandName: { $regex: term, $options: 'i' } },
      { productOrServiceName: { $regex: term, $options: 'i' } }
    ];

    // if the term is a number, also treat it as a maxBudget
    const num = Number(term);
    if (!isNaN(num)) {
      orClauses.push({ budget: { $lte: num } });
    }
  }

  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);

  try {
    const [total, campaigns] = await Promise.all([
      Campaign.countDocuments(filter),
      Campaign.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.max(1, limit))
        .populate('interestId', 'name')
    ]);

    return res.json({
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit)
      },
      campaigns
    });
  } catch (err) {
    console.error('Error fetching campaigns by category:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.checkApplied = async (req, res) => {
  const { campaignId, influencerId } = req.body;
  if (!campaignId || !influencerId) {
    return res.status(400).json({ message: 'campaignId and influencerId are required' });
  }

  try {
    // fetch campaign
    const campaign = await Campaign
      .findOne({ campaignsId: campaignId })
      .populate('interestId', 'name')
      .lean();
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    // check apply‐record
    const applied = await ApplyCampaign.exists({
      campaignId,
      'applicants.influencerId': influencerId
    });

    // attach flag
    campaign.isApplied = applied ? 1 : 0;
    return res.json(campaign);

  } catch (err) {
    console.error('Error in checkApplied:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getCampaignsByInfluencer = async (req, res) => {
  const { influencerId, search, page = 1, limit = 10 } = req.body;
  if (!influencerId) {
    return res.status(400).json({ message: 'influencerId is required' });
  }

  try {
    // 1) Load influencer → get categoryId
    const inf = await Influencer.findOne({ influencerId }, 'categoryId');
    if (!inf) {
      return res.status(404).json({ message: 'Influencer not found' });
    }
    const categoryId = inf.categoryId;
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ message: 'Invalid categoryId on influencer' });
    }

    // 2) Build campaign filter
    const filter = { interestId: categoryId, isActive: 1 };
    if (search?.trim()) {
      const term = search.trim();
      const or = [
        { brandName: { $regex: term, $options: 'i' } },
        { productOrServiceName: { $regex: term, $options: 'i' } }
      ];
      const num = Number(term);
      if (!isNaN(num)) or.push({ budget: { $lte: num } });
      filter.$or = or;
    }

    // 3) Fetch total + paginated campaigns
    const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
    const [total, campaigns] = await Promise.all([
      Campaign.countDocuments(filter),
      Campaign.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.max(1, limit))
        .populate('interestId', 'name')
        .lean()
    ]);

    // 4) Find all ApplyCampaign records for these campaigns
    const campaignIds = campaigns.map(c => c.campaignsId);
    const applyRecs = await ApplyCampaign.find({
      campaignId: { $in: campaignIds }
    }).lean();

    // Build applied + approved sets
    const appliedSet = new Set();
    const approvedMap = new Map();
    applyRecs.forEach(r => {
      if (Array.isArray(r.applicants) &&
        r.applicants.some(a => a.influencerId === influencerId)) {
        appliedSet.add(r.campaignId);
      }
      if (Array.isArray(r.approved) && r.approved.length > 0) {
        approvedMap.set(r.campaignId, r.approved[0].influencerId);
      }
    });

    // 5) Find all Contracts for these campaigns by this influencer
    //    and also pull `isAccepted`
    const contractRecs = await Contract.find({
      campaignId: { $in: campaignIds },
      influencerId  // only this influencer
    }, 'campaignId contractId isAccepted').lean();

    const contractMap = new Map();
    const acceptedMap = new Map();
    contractRecs.forEach(c => {
      contractMap.set(c.campaignId, c.contractId);
      acceptedMap.set(c.campaignId, c.isAccepted === 1 ? 1 : 0);
    });

    // 6) Annotate campaigns
    const annotated = campaigns.map(c => {
      const cid = c.campaignsId;
      const isContracted = contractMap.has(cid) ? 1 : 0;
      const contractId = contractMap.get(cid) || null;
      const isAccepted = acceptedMap.get(cid) || 0;

      return {
        ...c,
        isContracted,
        contractId,
        isAccepted    // ← newly added
      };
    });

    // 7) Return with meta
    return res.json({
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit)
      },
      campaigns: annotated
    });
  } catch (err) {
    console.error('Error in getCampaignsByInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getApprovedCampaignsByInfluencer = async (req, res) => {
  const { influencerId, search, page = 1, limit = 10 } = req.body;
  if (!influencerId) {
    return res.status(400).json({ message: 'influencerId is required' });
  }

  try {
    // 1) Fetch all contracts where this influencer is assigned
    const contractRecs = await Contract.find({
      influencerId,
      isAssigned: 1
    })
      .select('campaignId contractId isAccepted')
      .lean();

    const campaignIds = contractRecs.map(c => c.campaignId);
    if (campaignIds.length === 0) {
      return res.status(200).json({
        meta: { total: 0, page, limit, totalPages: 0 },
        campaigns: []
      });
    }

    // 2) Build a map of contract details
    const contractMap = new Map();
    const acceptedMap = new Map();
    contractRecs.forEach(c => {
      contractMap.set(c.campaignId, c.contractId);
      acceptedMap.set(c.campaignId, c.isAccepted === 1 ? 1 : 0);
    });

    // 3) Build campaign filter (only those assigned + active)
    const filter = {
      campaignsId: { $in: campaignIds },
      isActive: 1
    };
    if (search?.trim()) {
      const term = search.trim();
      const or = [
        { brandName: { $regex: term, $options: 'i' } },
        { productOrServiceName: { $regex: term, $options: 'i' } }
      ];
      const num = Number(term);
      if (!isNaN(num)) or.push({ budget: { $lte: num } });
      filter.$or = or;
    }

    // 4) Pagination math
    const pageNum = Math.max(1, page);
    const lim = Math.max(1, limit);
    const skip = (pageNum - 1) * lim;

    // 5) Count & fetch
    const total = await Campaign.countDocuments(filter);
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate('interestId', 'name')
      .lean();

    // 6) Annotate each with its contract info
    const annotated = campaigns.map(c => {
      const cid = c.campaignsId;
      return {
        ...c,
        isContracted: 1,                        // by definition
        contractId: contractMap.get(cid),
        isAccepted: acceptedMap.get(cid) || 0
      };
    });

    // 7) Respond
    return res.json({
      meta: {
        total,
        page: pageNum,
        limit: lim,
        totalPages: Math.ceil(total / lim)
      },
      campaigns: annotated
    });
  } catch (err) {
    console.error('Error in getAssignedCampaignsByInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};