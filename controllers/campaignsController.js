// controllers/campaignController.js

const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');
const multer   = require('multer');

const Campaign = require('../models/campaign');
const Brand    = require('../models/brand');
const Interest = require('../models/interest');

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
  upload(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      console.error('Multer Error:', err);
      return res.status(400).json({ message: err.message });
    } else if (err) {
      console.error('Unknown Upload Error:', err);
      return res.status(500).json({ message: 'Error uploading files.' });
    }

    try {
      // 1) Extract and JSON-parse fields from req.body
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

      // 2) Validate required fields
      if (!brandId) {
        return res.status(400).json({ message: 'brandId is required.' });
      }
      if (!productOrServiceName || !goal) {
        return res
          .status(400)
          .json({ message: 'productOrServiceName and goal are required.' });
      }

      // 3) Fetch brandName by brandId
      const brandDoc = await Brand.findOne({ brandId });
      if (!brandDoc) {
        return res.status(404).json({ message: 'Brand not found.' });
      }
      const brandName = brandDoc.name;

      // 4) JSON-parse targetAudience
      let audienceData = {
        age: { MinAge: 0, MaxAge: 0 },
        gender: 2,
        location: ''
      };
      if (targetAudience) {
        let parsedTA = targetAudience;
        if (typeof targetAudience === 'string') {
          try {
            parsedTA = JSON.parse(targetAudience);
          } catch {
            return res.status(400).json({ message: 'Invalid JSON in targetAudience.' });
          }
        }
        const { age, gender, location } = parsedTA;
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
      }

      // 5) JSON-parse and validate interestId array
      let validInterestIds = [];
      let interestNames = [];
      if (interestId) {
        let parsedInterests = interestId;
        if (typeof interestId === 'string') {
          try {
            parsedInterests = JSON.parse(interestId);
          } catch {
            return res.status(400).json({ message: 'Invalid JSON in interestId.' });
          }
        }
        if (!Array.isArray(parsedInterests)) {
          return res.status(400).json({ message: 'interestId must be an array.' });
        }
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
      }

      // 6) JSON-parse timeline
      let timelineData = {};
      if (timeline) {
        let parsedTL = timeline;
        if (typeof timeline === 'string') {
          try {
            parsedTL = JSON.parse(timeline);
          } catch {
            return res.status(400).json({ message: 'Invalid JSON in timeline.' });
          }
        }
        const { startDate, endDate } = parsedTL;
        if (startDate) {
          const sd = new Date(startDate);
          if (!isNaN(sd)) timelineData.startDate = sd;
        }
        if (endDate) {
          const ed = new Date(endDate);
          if (!isNaN(ed)) timelineData.endDate = ed;
        }
      }

      // 7) Determine isActive from timeline
      const isActiveFlag = computeIsActive(timelineData);

      // 8) Handle uploaded images and PDF files
      let imagePaths = [];
      if (Array.isArray(req.files['image'])) {
        imagePaths = req.files['image'].map(file => {
          return path.join('uploads', path.basename(file.path));
        });
      }

      let pdfPaths = [];
      if (Array.isArray(req.files['creativeBrief'])) {
        pdfPaths = req.files['creativeBrief'].map(file => {
          return path.join('uploads', path.basename(file.path));
        });
      }

      // 9) Construct and save the new Campaign
      const newCampaign = new Campaign({
        brandId: brandId,
        brandName: brandName,
        productOrServiceName,
        description,
        targetAudience: audienceData,
        interestId: validInterestIds,
        interestName: interestNames.join(','),
        goal,
        creativeBriefText,
        budget,
        timeline: timelineData,
        images: imagePaths,
        creativeBrief: pdfPaths,
        additionalNotes,
        isActive: isActiveFlag
      });

      await newCampaign.save();
      return res.status(201).json({ message: 'Campaign created successfully.' });
    } catch (error) {
      console.error('Error in createCampaign:', error);
      return res
        .status(500)
        .json({ message: 'Internal server error while creating campaign.' });
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
    const brandId = req.query.brandId;
    if (!brandId) {
      return res.status(400).json({ message: 'Query parameter brandId is required.' });
    }

    // Find campaigns where brandId matches and isActive = 1
    const campaigns = await Campaign.find({
      brandId: brandId,
      isActive: 1
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
      { brandName:            { $regex: term, $options: 'i' } },
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
    const [ total, campaigns ] = await Promise.all([
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
        page:       Number(page),
        limit:      Number(limit),
        totalPages: Math.ceil(total / limit)
      },
      campaigns
    });
  } catch (err) {
    console.error('Error fetching campaigns by category:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};