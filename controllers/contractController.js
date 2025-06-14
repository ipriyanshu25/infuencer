const PDFDocument = require('pdfkit');
const Contract = require('../models/contract');
const Brand = require('../models/brand');
const Influencer = require('../models/influencer');
const Campaign = require('../models/campaign');

exports.sendOrGenerateContract = async (req, res) => {
    try {
        const {
            brandId,
            influencerId,
            campaignId,
            effectiveDate,
            deliverableDescription,
            feeAmount,
            term,
            type
        } = req.body;

        if (!brandId || !influencerId || !campaignId) {
            return res.status(400).json({ message: 'brandId, influencerId, and campaignId are required' });
        }

        const brand = await Brand.findOne({ brandId });
        const influencer = await Influencer.findOne({ influencerId });
        const campaign = await Campaign.findOne({ campaignsId: campaignId });

        if (!brand || !influencer || !campaign) {
            return res.status(404).json({ message: 'Brand, Influencer, or Campaign not found' });
        }

        if (type === 0) {
            // 🔻 Generate PDF and send as response
            const doc = new PDFDocument({ margin: 50 });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=Influencer_Contract.pdf');

            doc.pipe(res);

            // PDF Title
            doc.fontSize(18).font('Times-Bold').text('INFLUENCER COLLABORATION AGREEMENT', {
                align: 'center',
                underline: true
            });
            doc.moveDown(2);

            // Agreement Date
            doc.fontSize(12).font('Times-Roman').text(`This Agreement is made on ${effectiveDate} between:`);
            doc.moveDown();

            // Section 1: Parties
            doc.font('Times-Bold').text('1. Parties');
            doc.font('Times-Roman').text(`- Brand: ${brand.name}`);
            doc.text(`- Influencer: ${influencer.name}`);
            doc.moveDown();

            // Section 2: Scope of Work
            doc.font('Times-Bold').text('2. Scope of Work');
            doc.font('Times-Roman').text(`Influencer will create and publish ${deliverableDescription} on the agreed platform(s) according to Brand’s guidelines.`);
            doc.moveDown();

            // Section 3: Compensation
            doc.font('Times-Bold').text('3. Compensation');
            doc.font('Times-Roman').text(`Brand agrees to pay Influencer ${feeAmount}.`);
            doc.text(`Payment to be made via ${term.paymentMethod} within ${term.paymentTerms} days of content publication.`);
            doc.moveDown();

            // Section 4: Term
            const startDate = new Date(campaign.timeline?.startDate).toDateString();
            const endDate = new Date(campaign.timeline?.endDate).toDateString();

            doc.font('Times-Bold').text('4. Term');
            doc.font('Times-Roman').text(`This Agreement begins on ${startDate} and ends on ${endDate}, unless earlier terminated in writing.`);
            doc.moveDown();

            // Section 5: Signatures
            doc.font('Times-Bold').text('5. Signatures');
            doc.moveDown(2);
            doc.font('Times-Roman').text('_____________________________');
            doc.text('Brand Representative');
            doc.moveDown(2);
            doc.text('_____________________________');
            doc.text('Influencer');

            doc.end();
            return; // Important to end after sending response
        }

        // 🔺 Type 1: Save contract to database
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
        console.error('Error in sendOrGenerateContract:', error);
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


