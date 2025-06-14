const Contract = require('../models/contract');
const Brand = require('../models/brand');
const Influencer = require('../models/influencer');
const Campaign = require('../models/campaign'); // Make sure this exists and has timeline field

exports.sendContract = async (req, res) => {
    try {
        const {
            brandId,
            influencerId,
            campaignId,
            effectiveDate,
            deliverableDescription,
            feeAmount,
            term
        } = req.body;

        // Validate required inputs
        if (!brandId || !influencerId || !campaignId) {
            return res.status(400).json({ message: 'brandId, influencerId, and campaignId are required' });
        }

        // Fetch timeline from campaign
        const campaign = await Campaign.findOne({ campaignsId: campaignId });
        if (!campaign || !campaign.timeline) {
            return res.status(404).json({ message: 'Timeline not found for campaign' });
        }

        // Fetch Brand Name
        const brand = await Brand.findOne({ brandId });
        if (!brand) {
            return res.status(404).json({ message: 'Brand not found' });
        }

        // Fetch Influencer Name
        const influencer = await Influencer.findOne({ influencerId });
        if (!influencer) {
            return res.status(404).json({ message: 'Influencer not found' });
        }

        // Create Contract
        const newContract = new Contract({
            brandId,
            influencerId,
            campaignId,
            brandName: brand.name,
            influencerName: influencer.name,
            effectiveDate,
            deliverableDescription,
            feeAmount,
            term,
            timeline: {
                startDate: campaign.timeline.startDate,
                endDate: campaign.timeline.endDate
            }
        });

        await newContract.save();

        res.status(201).json({
            message: 'Contract created successfully',
            contract: newContract
        });

    } catch (error) {
        console.error('Error creating contract:', error);
        res.status(500).json({ error: error.message });
    }
};



exports.getContract = async (req, res) => {
    try {
        const { brandId, influencerId } = req.body;

        if (!brandId || !influencerId) {
            return res.status(400).json({ message: 'brandId and influencerId are required' });
        }

        const contracts = await Contract.find({ brandId, influencerId });

        if (contracts.length === 0) {
            return res.status(404).json({ message: 'No contracts found for the given Brand and Influencer' });
        }

        res.status(200).json({ contracts });
    } catch (error) {
        console.error('Error fetching contract:', error);
        res.status(500).json({ error: error.message });
    }
};