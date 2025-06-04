// controllers/campaignController.js

const Campaign = require('../models/campaign');
const Brand    = require('../models/brand');

exports.createCampaign = async (req, res) => {
  try {
    const {
      brandId, // this is the UUID of the brand creating the campaign
      productOrServiceName,
      description,
      targetAudience,
      goal
    } = req.body;
    if (!brandId) {
      return res.status(400).json({ message: 'BrandId is required.' });
    }
    if (!productOrServiceName || !goal) {
      return res
        .status(400)
        .json({ message: 'productOrServiceName and goal are required.' });
    }
    const brandDoc = await Brand.findOne({ brandId: brandId });
    if (!brandDoc) {
      return res.status(404).json({ message: 'Brand not found.' });
    }
    const brandName = brandDoc.name; // Assuming brandName is stored in the brand document
    const newCampaign = new Campaign({
      brandId:brandId,
      brandName: brandName,
      productOrServiceName,
      description,
      targetAudience,
      goal
    });

    await newCampaign.save();
    return res
      .status(201)
      .json({ message: 'Campaign created successfully.' });
  } catch (error) {
    console.error('Error in createCampaign:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while creating campaign.' });
  }
};

//
// Get all campaigns
//
exports.getAllCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    return res.json(campaigns);
  } catch (error) {
    console.error('Error in getAllCampaigns:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while fetching campaigns.' });
  }
};

//
// Get a single campaign by its campaignsId (UUID)
//
exports.getCampaignById = async (req, res) => {
  try {
    // Extract campaignsId from query string (?id=)
    const campaignsId = req.query.id;
    if (!campaignsId) {
      return res.status(400).json({ message: 'Query parameter id is required.' });
    }

    const campaign = await Campaign.findOne({ campaignsId: campaignsId });
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

//
// Update an existing campaign by campaignsId
//
exports.updateCampaign = async (req, res) => {
  try {
    const { campaignsId } = req.body; // UUID
    const updates = req.body;
    if (!campaignsId) {
      return res.status(400).json({ message: 'CampaignsId is required.' });
    }
    const updatedCampaign = await Campaign.findOneAndUpdate(
      { campaignsId: campaignsId },
      updates,
      {
        new: true,        
        runValidators: true 
      }
    );

    if (!updatedCampaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    return res.json({
      message: 'Campaign updated successfully.',
      campaign: updatedCampaign
    });
  } catch (error) {
    console.error('Error in updateCampaign:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while updating campaign.' });
  }
};

//
// Delete a campaign by campaignsId
//
exports.deleteCampaign = async (req, res) => {
  try {
    const { campaignsId } = req.body; // UUID
    if (!campaignsId) {
      return res.status(400).json({ message: 'CampaignsId is required.' });
    }
    const deleted = await Campaign.findOneAndDelete({ campaignsId: campaignsId });

    if (!deleted) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    return res.json({ message: 'Campaign deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteCampaign:', error);
    return res
      .status(500)
      .json({ message: 'Internal server error while deleting campaign.' });
  }
};
