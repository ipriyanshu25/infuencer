const PDFDocument      = require('pdfkit');
const Contract         = require('../models/contract');
const Campaign         = require('../models/campaign');
const ApplyCampaign    = require('../models/applyCampaign');

exports.sendOrGenerateContract = async (req, res) => {
  try {
    const {
      campaignId,
      effectiveDate,
      brandName,
      brandAddress,
      influencerName,
      influencerAddress,
      influencerHandle,
      feeAmount,
      paymentTerms,    // from textarea
      type             // 0 = PDF, 1 = save
    } = req.body;

    // 1) Validate basic inputs
    if (![0, 1].includes(+type)) {
      return res.status(400).json({ message: 'Invalid type. Must be 0 (PDF) or 1 (save)' });
    }
    if (!campaignId || !effectiveDate || !brandName || !brandAddress
        || !influencerName || !influencerAddress || !influencerHandle
        || !feeAmount || !paymentTerms) {
      return res.status(400).json({
        message: 'All of campaignId, effectiveDate, brandName, brandAddress, influencerName, influencerAddress, influencerHandle, feeAmount and paymentTerms are required'
      });
    }

    // 2) Load campaign for timeline
    const campaign = await Campaign.findOne({ campaignsId: campaignId });
    if (!campaign || !campaign.timeline) {
      return res.status(404).json({ message: 'Campaign or timeline not found' });
    }

    // 3) Build payload
    const contractData = {
      campaignId,
      effectiveDate,
      brandName,
      brandAddress,
      influencerName,
      influencerAddress,
      influencerHandle,
      deliverableDescription: paymentTerms,
      feeAmount,
      timeline: {
        startDate: campaign.timeline.startDate,
        endDate:   campaign.timeline.endDate
      },
      type,
      isAssigned: 1
    };

    // 4) type=0 → stream PDF (no DB save)
    if (+type === 0) {
      const doc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=Contract.pdf');
      doc.pipe(res);

      doc.fontSize(20).text('Influencer Marketing Contract', { align: 'center' });
      doc.moveDown();

      doc.fontSize(14).text('Contract Details', { underline: true });
      doc.fontSize(12).text(`Effective Date: ${effectiveDate}`);
      doc.text(`Start Date: ${new Date(campaign.timeline.startDate).toDateString()}`);
      doc.text(`End Date: ${new Date(campaign.timeline.endDate).toDateString()}`);
      doc.moveDown();

      doc.fontSize(14).text('Parties Involved', { underline: true });
      doc.fontSize(12).text(`Brand: ${brandName}`);
      doc.text(`Address: ${brandAddress}`);
      doc.moveDown();
      doc.text(`Influencer: ${influencerName}`);
      doc.text(`Address: ${influencerAddress}`);
      doc.text(`Handle: ${influencerHandle}`);
      doc.moveDown();

      doc.fontSize(14).text('Deliverables', { underline: true });
      doc.fontSize(12).text(paymentTerms);
      doc.moveDown();

      doc.fontSize(14).text('Compensation', { underline: true });
      doc.fontSize(12).text(`Fee: $${feeAmount}`);
      doc.moveDown();

      doc.fontSize(14).text('Signatures', { underline: true });
      doc.moveDown(2);
      doc.text('_________________________\nBrand Representative');
      doc.moveDown(2);
      doc.text('_________________________\nInfluencer');

      doc.end();
      return;
    }

    // 5) type=1 → save to DB
    const newContract = new Contract(contractData);
    await newContract.save();

    // 6) Mark approved in ApplyCampaign
    let appRec = await ApplyCampaign.findOne({ campaignId });
    if (!appRec) {
      appRec = new ApplyCampaign({
        campaignId,
        applicants: [],
        approved:   [{ influencerName }]
      });
    } else {
      appRec.approved = [{ influencerName }];
    }
    await appRec.save();

    // 7) Respond
    return res.status(201).json({
      message:  'Contract created and saved successfully',
      contract: newContract
    });

  } catch (error) {
    console.error('Error in sendOrGenerateContract:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


exports.getContract = async (req, res) => {
  try {
    const { brandName, influencerName } = req.body;
    if (!brandName || !influencerName) {
      return res.status(400).json({ message: 'brandName and influencerName are required' });
    }

    const contracts = await Contract.find({ brandName, influencerName });
    if (!contracts.length) {
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
      return res.status(400).json({ message: 'contractId is required' });
    }

    const contract = await Contract.findOne({ contractId });
    if (!contract || !contract.timeline) {
      return res.status(404).json({ message: 'Contract or timeline not found' });
    }

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Contract-${contractId}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text('INFLUENCER COLLABORATION AGREEMENT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`This Agreement is made on ${contract.effectiveDate} between:\n`);
    doc.text(`1. Brand: ${contract.brandName}`);
    doc.text(`   Address: ${contract.brandAddress}`);
    doc.moveDown();
    doc.text(`2. Influencer: ${contract.influencerName}`);
    doc.text(`   Address: ${contract.influencerAddress}`);
    doc.text(`   Handle: ${contract.influencerHandle}`);
    doc.moveDown();

    doc.text(`3. Scope of Work\n${contract.deliverableDescription}`);
    doc.moveDown();

    doc.text(`4. Compensation\nBrand agrees to pay Influencer $${contract.feeAmount}.`);
    doc.moveDown();

    doc.text(`5. Term\nFrom ${new Date(contract.timeline.startDate).toDateString()} to ${new Date(contract.timeline.endDate).toDateString()}.`);
    doc.moveDown();

    doc.text('6. Signatures\n');
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
      return res.status(400).json({ message: 'contractId is required' });
    }

    const contract = await Contract.findOne({ contractId });
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

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
