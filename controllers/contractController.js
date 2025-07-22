// controllers/contractController.js

const PDFDocument      = require('pdfkit');
const Contract         = require('../models/contract');
const Campaign         = require('../models/campaign');
const Brand            = require('../models/brand');
const Influencer       = require('../models/influencer');
const ApplyCampaign    = require('../models/applyCampaign');

exports.sendOrGenerateContract = async (req, res) => {
  try {
    const {
      brandId,
      influencerId,
      campaignId,
      effectiveDate,
      brandName,
      brandAddress,
      influencerName,
      influencerAddress,
      influencerHandle,
      feeAmount,
      paymentTerms,    // textarea
      type             // 0 = PDF, 1 = save
    } = req.body;

    // 1) Validate
    if (![0,1].includes(+type)) {
      return res.status(400).json({ message: 'Invalid type; must be 0 (PDF) or 1 (save)' });
    }
    if (!brandId || !influencerId || !campaignId
        || !effectiveDate || !brandName || !brandAddress
        || !influencerName || !influencerAddress || !influencerHandle
        || !feeAmount || !paymentTerms) {
      return res.status(400).json({
        message: 'brandId, influencerId, campaignId, effectiveDate, brandName, brandAddress, influencerName, influencerAddress, influencerHandle, feeAmount and paymentTerms are all required'
      });
    }

    // 2) Load related records
    const [ campaign, brand, influencer ] = await Promise.all([
      Campaign.findOne({ campaignsId: campaignId }),
      Brand.findOne({ brandId }),
      Influencer.findOne({ influencerId })
    ]);

    if (!campaign)      return res.status(404).json({ message: 'Campaign not found' });
    if (!brand)         return res.status(404).json({ message: 'Brand not found' });
    if (!influencer)    return res.status(404).json({ message: 'Influencer not found' });

    // 3) Build payload
    const contractData = {
      brandId,
      influencerId,
      campaignId,
      brandName,
      effectiveDate, 
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

    // 4) PDF only?
    if (+type === 0) {
      const doc = new PDFDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=Contract.pdf');
      doc.pipe(res);

      // — Logos (only if defined) —
      const logoSize = 50;
      if (brand.logoUrl) {
        try {
          doc.image(
            brand.logoUrl,
            doc.page.margins.left,
            doc.page.margins.top,
            { width: logoSize }
          );
        } catch (err) {
          console.warn('Could not load brand logo:', err.message);
        }
      }
      if (influencer.logoUrl) {
        try {
          const x = doc.page.width - doc.page.margins.right - logoSize;
          doc.image(
            influencer.logoUrl,
            x,
            doc.page.margins.top,
            { width: logoSize }
          );
        } catch (err) {
          console.warn('Could not load influencer logo:', err.message);
        }
      }
      doc.moveDown(4);

      // — Header —
      doc.fontSize(20)
         .text('Influencer Marketing Contract', { align: 'center' })
         .moveDown();

      // — Details —
      doc.fontSize(14).text('Contract Details', { underline: true });
      doc.fontSize(12)
         .text(`Effective Date: ${effectiveDate}`)
         .text(`Start Date: ${new Date(campaign.timeline.startDate).toDateString()}`)
         .text(`End Date:   ${new Date(campaign.timeline.endDate).toDateString()}`)
         .moveDown();

      // — Parties —
      doc.fontSize(14).text('Parties Involved', { underline: true });
      doc.fontSize(12)
         .text(`Brand:      ${brandName}`)
         .text(`Address:    ${brandAddress}`)
         .moveDown()
         .text(`Influencer: ${influencerName}`)
         .text(`Address:    ${influencerAddress}`)
         .text(`Handle:     ${influencerHandle}`)
         .moveDown();

      // — Deliverables —
      doc.fontSize(14).text('Deliverables', { underline: true });
      doc.fontSize(12)
         .text(paymentTerms)
         .moveDown();

      // — Compensation —
      doc.fontSize(14).text('Compensation', { underline: true });
      doc.fontSize(12)
         .text(`Fee: $${feeAmount}`)
         .moveDown();

      // — Signatures —
      doc.fontSize(14)
         .text('Signatures', { underline: true })
         .moveDown(2);
      doc.text('_________________________\nBrand Representative')
         .moveDown(2);
      doc.text('_________________________\nInfluencer');

      doc.end();
      return;
    }

    // 5) Save to DB
    const newContract = new Contract(contractData);
    await newContract.save();

    // 6) Mark approved
    let appRec = await ApplyCampaign.findOne({ campaignId });
    if (!appRec) {
      appRec = new ApplyCampaign({
        campaignId,
        applicants: [],
        approved:   [{ influencerId, name: influencerName }]
      });
    } else {
      appRec.approved = [{ influencerId, name: influencerName }];
    }
    await appRec.save();

    // 7) Respond
    return res.status(201).json({
      message:  'Contract created and saved successfully',
      contract: newContract
    });

  } catch (err) {
    console.error('Error in sendOrGenerateContract:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};


exports.getContract = async (req, res) => {
  try {
    const { brandId, influencerId } = req.body;
    if (!brandId || !influencerId) {
      return res.status(400).json({ message: 'brandId and influencerId are required' });
    }
    const contracts = await Contract.find({ brandId, influencerId });
    if (!contracts.length) {
      return res.status(404).json({ message: 'No contracts found for that Brand & Influencer' });
    }
    res.status(200).json({ contracts });
  } catch (err) {
    console.error('Error fetching contracts:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.viewContractPdf = async (req, res) => {
  try {
    const { contractId } = req.body;
    if (!contractId) {
      return res.status(400).json({ message: 'contractId is required' });
    }

    const contract = await Contract.findOne({ contractId });
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    // re-fetch to get logos & timeline
    const [ campaign, brand, influencer ] = await Promise.all([
      Campaign.findOne({ campaignsId: contract.campaignId }),
      Brand.findOne({ brandId: contract.brandId }),
      Influencer.findOne({ influencerId: contract.influencerId })
    ]);
    if (!campaign?.timeline || !brand || !influencer) {
      return res.status(404).json({ message: 'Related data missing' });
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Contract-${contractId}.pdf`);
    doc.pipe(res);

    // Logos (conditional)
    const logoSize = 50;
    if (brand.logoUrl) {
      try {
        doc.image(
          brand.logoUrl,
          doc.page.margins.left,
          doc.page.margins.top,
          { width: logoSize }
        );
      } catch (err) {
        console.warn('Brand logo failed to load:', err.message);
      }
    }
    if (influencer.logoUrl) {
      try {
        const x = doc.page.width - doc.page.margins.right - logoSize;
        doc.image(
          influencer.logoUrl,
          x,
          doc.page.margins.top,
          { width: logoSize }
        );
      } catch (err) {
        console.warn('Influencer logo failed to load:', err.message);
      }
    }
    doc.moveDown(4);

    // Body
    doc.fontSize(20)
       .text('INFLUENCER COLLABORATION AGREEMENT', { align: 'center' })
       .moveDown();

    doc.fontSize(12)
       .text(`This Agreement is made on ${contract.effectiveDate} between:\n`)
       .text(`1. Brand:      ${contract.brandName}`)
       .text(`   Address:    ${contract.brandAddress}`)
       .moveDown()
       .text(`2. Influencer: ${contract.influencerName}`)
       .text(`   Address:    ${contract.influencerAddress}`)
       .text(`   Handle:     ${contract.influencerHandle}`)
       .moveDown()
       .text(`3. Scope of Work\n${contract.deliverableDescription}`)
       .moveDown()
       .text(`4. Compensation\nBrand agrees to pay Influencer $${contract.feeAmount}.`)
       .moveDown()
       .text(
         `5. Term\nFrom ${new Date(campaign.timeline.startDate).toDateString()} to ${new Date(campaign.timeline.endDate).toDateString()}.`
       )
       .moveDown()
       .text('6. Signatures\n')
       .moveDown()
       .text('_____________________________\nBrand Representative')
       .moveDown()
       .text('_____________________________\nInfluencer');

    doc.end();

  } catch (err) {
    console.error('Error generating contract PDF:', err);
    res.status(500).json({ error: err.message });
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
    res.status(200).json({ message: 'Contract approved successfully', contract });
  } catch (err) {
    console.error('Error approving contract:', err);
    res.status(500).json({ error: err.message });
  }
};
