const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const contractSchema = new mongoose.Schema({
    contractId: {
        type: String,
        required: true,
        unique: true,
        default: uuidv4
    },
    brandId: {
        type: String,
        required: true,
        ref: 'Brand'
    },
    influencerId: {
        type: String,
        required: true,
        ref: 'Influencer'
    },
    campaignId: {
        type: String,
        required: true,
        ref: 'Campaign'
    },
    brandName: {
        type: String,
        required: true
    },
    influencerName: {
        type: String,
        required: true
    },
    effectiveDate: {
        type: String,
        required: true
    },
    deliverableDescription: {
        type: String,
        required: true
    },
    feeAmount: {
        type: String,
        required: true
    },
    term: {
        paymentMethod: {
            type: String,
            required: true
        },
        paymentTerms: {
            type: Number,
            required: true
        }
    },
    timeline: {
        startDate: { type: Date },
        endDate: { type: Date }
    },
    type: {
        type: Number, // 0 = PDF only, 1 = Save
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isAccepted:{
        type:Number,
        default:0
    }
});

module.exports = mongoose.model('Contract', contractSchema);
