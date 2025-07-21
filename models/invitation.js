const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Invitation Schema
 * Stores the relationship between Brand, Influencer, and Campaign,
 * along with acceptance status and embedded Brand & Campaign details.
 */
const invitationSchema = new mongoose.Schema({
    invitationId: { type: String, required: true, unique: true, default: uuidv4 },

    // References to existing models
    brandId: { type: String, ref: 'Brand', required: true },
    influencerId: { type: String, ref: 'Influencer', required: true },
    campaignId: { type: String, ref: 'Campaign', required: true },

    // 0: not accepted, 1: accepted
    isAccepted: { type: Number, enum: [0, 1], default: 0 },

    // Embedded brand details for quick access
    brand: {
        brandId: { type: String },
        name: { type: String },
        email: { type: String },
        phone: { type: String }
    },

    // Embedded campaign details for quick access
    campaign: {
        campaignsId: { type: String },
        brandName: { type: String },
        productOrServiceName: { type: String },
        description: { type: String },
        budget: {
            type: Number,
            default: 0
        },
        timeline: {
            startDate: { type: Date },
            endDate: { type: Date }
        }
    }
}, { timestamps: true });

invitationSchema.index(
    { campaignId: 1, influencerId: 1 },
    { unique: true }
);

module.exports = mongoose.model('Invitation', invitationSchema);
