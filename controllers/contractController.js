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

        if (![0, 1].includes(type)) {
            return res.status(400).json({ message: 'Invalid type. Must be 0 (PDF only) or 1 (save)' });
        }

        if (!brandId || !influencerId || !campaignId) {
            return res.status(400).json({ message: 'brandId, influencerId, and campaignId are required' });
        }

        const campaign = await Campaign.findOne({ campaignsId: campaignId });
        if (!campaign || !campaign.timeline) {
            return res.status(404).json({ message: 'Timeline not found for campaign' });
        }

        const brand = await Brand.findOne({ brandId });
        if (!brand) {
            return res.status(404).json({ message: 'Brand not found' });
        }

        const influencer = await Influencer.findOne({ influencerId });
        if (!influencer) {
            return res.status(404).json({ message: 'Influencer not found' });
        }

        // Create contract object
        const contractData = {
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
            },
            type
        };

        // Type 0: Generate PDF only
        if (type === 0) {
            const doc = new PDFDocument();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=Contract.pdf`);
            doc.pipe(res);

            doc.fontSize(20).text('Influencer Marketing Contract', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(14).text('Contract Details', { underline: true });
            doc.fontSize(12).text(`Effective Date: ${effectiveDate}`);
            doc.text(`Start Date: ${new Date(campaign.timeline.startDate).toDateString()}`);
            doc.text(`End Date: ${new Date(campaign.timeline.endDate).toDateString()}`);
            doc.moveDown();

            doc.fontSize(14).text('Parties Involved', { underline: true });
            doc.fontSize(12).text(`Brand Name: ${brand.name}`);
            doc.text(`Influencer Name: ${influencer.name}`);
            doc.moveDown();

            doc.fontSize(14).text('Deliverables', { underline: true });
            doc.fontSize(12).text(deliverableDescription);
            doc.moveDown();

            doc.fontSize(14).text('Compensation Details', { underline: true });
            doc.fontSize(12).text(`Fee Amount: ${feeAmount}`);
            doc.text(`Payment Method: ${term.paymentMethod}`);
            doc.text(`Payment Terms: ${term.paymentTerms} days`);
            doc.moveDown();

            doc.fontSize(14).text('Signatures', { underline: true });
            doc.text('\n\n_________________________\nBrand Representative');
            doc.text('\n\n_________________________\nInfluencer');

            doc.end(); // Finish PDF
            return;
        }

        // Type 1: Save contract to DB
        const newContract = new Contract(contractData);
        await newContract.save();

        res.status(201).json({
            message: 'Contract created and saved successfully',
            contract: newContract
        });

    } catch (error) {
        console.error('Error processing contract:', error);
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




exports.viewContractPdf = async (req, res) => {
    try {
        const { contractId } = req.body;

        if (!contractId) {
            return res.status(400).json({ message: 'contractId is required in the request body' });
        }

        // Fetch contract
        const contract = await Contract.findOne({ contractId });
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }

        // Fetch related data
        const [campaign, brand, influencer] = await Promise.all([
            Campaign.findOne({ campaignsId: contract.campaignId }),
            Brand.findOne({ brandId: contract.brandId }),
            Influencer.findOne({ influencerId: contract.influencerId }),
        ]);

        if (!campaign || !campaign.timeline) {
            return res.status(404).json({ message: 'Campaign or timeline not found' });
        }

        if (!brand || !influencer) {
            return res.status(404).json({ message: 'Brand or Influencer not found' });
        }

        // Prepare PDF
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Contract-${contractId}.pdf`);
        doc.pipe(res);

        doc.fontSize(20).text('INFLUENCER COLLABORATION AGREEMENT', { align: 'center' });
        doc.moveDown();

        doc.fontSize(12).text(`This Agreement is made on ${contract.effectiveDate} between:\n`);
        doc.text(`1. Parties\n- Brand: ${brand.name}\n- Influencer: ${influencer.name}`);
        doc.moveDown();

        doc.text(`2. Scope of Work\nInfluencer will create and publish ${contract.deliverableDescription} on specified platform(s) according to Brand’s guidelines.`);
        doc.moveDown();

        doc.text(`3. Compensation\nBrand agrees to pay Influencer ${contract.feeAmount}. Payment to be made via ${contract.term.paymentMethod} within ${contract.term.paymentTerms} days of content publication.`);
        doc.moveDown();

        doc.text(`4. Term\nThis Agreement begins on ${new Date(contract.timeline.startDate).toDateString()} and ends on ${new Date(contract.timeline.endDate).toDateString()}, unless earlier terminated in writing.`);
        doc.moveDown();

        doc.text('5. Signatures\n');
        doc.moveDown();
        doc.text('_____________________________\nBrand Representative');
        doc.moveDown();
        doc.text('_____________________________\nInfluencer');

        doc.end();

    } catch (error) {
        console.error('Error generating contract PDF:', error);
        res.status(500).json({ error: error.message });
    }
};



exports.acceptContract = async (req, res) => {
    try {
        const { contractId } = req.body;

        if (!contractId) {
            return res.status(400).json({ message: 'contractId is required in the request body' });
        }

        const contract = await Contract.findOne({ contractId });

        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }

        // Update the isAccepted field
        contract.isAccepted = 1;
        await contract.save();

        res.status(200).json({
            message: 'Contract approved successfully',
            contract
        });

    } catch (error) {
        console.error('Error approving contract:', error);
        res.status(500).json({ error: error.message });
    }
};