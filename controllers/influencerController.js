// controllers/influencerController.js
require('dotenv').config();
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mongoose   = require('mongoose');

const Influencer        = require('../models/influencer');
const Interest          = require('../models/interest');
const AudienceRange     = require('../models/audience');
const Country           = require('../models/country');
const subscriptionHelper= require('../utils/subscriptionHelper');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const JWT_SECRET= process.env.JWT_SECRET;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

/**
 * STEP 1: Request OTP
 * POST /influencer/request-otp
 * Body: { email }
 */
exports.requestOtpInfluencer = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const code      = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // upsert so we can save an email-only doc first
  await Influencer.findOneAndUpdate(
    { email },
    {
      $set: {
        otpCode:      code,
        otpExpiresAt: expiresAt,
        otpVerified:  false
      }
    },
    { upsert: true, new: true }
  );

  await transporter.sendMail({
    from:    `"No-Reply" <${SMTP_USER}>`,
    to:      email,
    subject: 'Verify Influencer',
    text:    `Your verification code is ${code}. It expires in 10 minutes.`
  });

  res.json({ message: 'OTP sent to email' });
};


/**
 * STEP 2: Verify OTP
 * POST /influencer/verify-otp
 * Body: { email, otp }
 */
exports.verifyOtpInfluencer = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || otp == null) {
    return res.status(400).json({ message: 'Email and otp required' });
  }

  // atomically match and set verified, skipping full validation
  const updated = await Influencer.findOneAndUpdate(
    {
      email,
      otpCode: otp.toString().trim(),
      otpExpiresAt: { $gt: new Date() }
    },
    {
      $set: { otpVerified: true },
      $unset: { otpCode: "", otpExpiresAt: "" }
    },
    { new: true, runValidators: false }
  );

  if (!updated) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }

  res.json({ message: 'Email verified — you may now complete registration' });
};

/**
 * STEP 3: Complete registration
 * POST /influencer/register
 * Body: { name, email, password, phone, socialMedia, categoryId, audienceId, countryId, callingId, bio }
 */
exports.registerInfluencer = async (req, res) => {
  const {
    name, email, password, phone,
    socialMedia, categoryId, audienceId,
    countryId, callingId, bio
  } = req.body;

  // 1) Check OTP
  const inf = await Influencer.findOne({ email });
  if (!inf || !inf.otpVerified) {
    return res.status(400).json({ message: 'Email not verified' });
  }
  if (inf.name) {
    return res.status(400).json({ message: 'Already registered' });
  }

  // 2) Validate refs
  const [interestDoc, audienceDoc, countryDoc, callingDoc] = await Promise.all([
    Interest.findById(categoryId),
    AudienceRange.findById(audienceId),
    Country.findById(countryId),
    Country.findById(callingId)
  ]);
  if (!interestDoc || !audienceDoc || !countryDoc || !callingDoc) {
    return res.status(400).json({ message: 'Invalid reference IDs' });
  }

  // 3) Fill in fields
  inf.name         = name;
  inf.password     = password;
  inf.phone        = phone;
  inf.socialMedia  = socialMedia;
  inf.categoryId   = categoryId;
  inf.categoryName = interestDoc.name;
  inf.audienceId   = audienceId;
  inf.audienceRange= audienceDoc.range;
  inf.countryId    = countryId;
  inf.county       = countryDoc.countryName;
  inf.callingId    = callingId;
  inf.callingcode  = callingDoc.callingCode;
  inf.bio          = bio;

  // 4) Assign free plan
  const freePlan = await subscriptionHelper.getFreePlan('Influencer');
  if (freePlan) {
    const expires = subscriptionHelper.computeExpiry(freePlan);
    inf.subscription = {
      planId:    freePlan.planId,
      planName:  freePlan.name,
      startedAt: new Date(),
      expiresAt: expires,
      features:  freePlan.features.map(f => ({
        key:   f.key,
        limit: typeof f.value === 'number' ? f.value : 0,
        used:  0
      }))
    };
    inf.subscriptionExpired = false;
  }

  await inf.save();  // now all required fields are present
  return res.status(201).json({
    message:      'Influencer registered successfully',
    influencerId: inf.influencerId,
    subscription: inf.subscription
  });
};


// Login an influencer
exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Both fields are required' });
  }

  try {
    // 1) Find influencer by email, case‐insensitive
    const influencer = await Influencer.findOne({
      email: { $regex: `^${email.trim()}$`, $options: 'i' }
    });
    if (!influencer) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    // 2) Check password
    const isMatch = await influencer.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // 3) Issue JWT
    const token = jwt.sign(
      { influencerId: influencer.influencerId, email: influencer.email },
      JWT_SECRET,
      { expiresIn: '100d' }
    );

    // 4) Return profile + token
    return res.status(200).json({
      message:    'Login successful',
      influencerId: influencer.influencerId,
      categoryId:   influencer.categoryId,
      token
    });
  } catch (error) {
    console.error('Error in influencer.login:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Middleware to verify JWT token
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(403).json({ message: 'Token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.influencer = decoded;
    next();
  });
};

exports.getList = async (req, res) => {
  try {
    const influencers = await Influencer.find({}, '-password -__v');
    return res.status(200).json(influencers);
  } catch (error) {
    console.error('Error fetching influencers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get a single influencer by influencerId
exports.getById = async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ message: 'influencerId query parameter is required' });
  }
  try {
    const influencer = await Influencer.findOne({ influencerId: id }, '-password -__v');
    if (!influencer) {
      return res.status(404).json({ message: 'Influencer not found' });
    }
    return res.status(200).json(influencer);
  } catch (error) {
    console.error('Error fetching influencer by ID:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


exports.getCampaignsByInfluencer = async (req, res) => {
  try {
    const {
      influencerId,
      page    = 1,
      limit   = 10,
      search  = '',
      sortBy    = 'createdAt',
      sortOrder = 'desc'    // 'asc' or 'desc'
    } = req.body;

    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required' });
    }

    // Build filter
    const filter = { influencerId };
    if (search.trim()) {
      filter.$or = [
        { name:        { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Math.max(page,1) - 1) * Math.max(limit,1);
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // Total count for pagination
    const total = await Campaign.countDocuments(filter);

    // Fetch paged, sorted campaigns
    const campaigns = await Campaign.find(filter)
      .sort({ [sortBy]: sortDirection })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      total,
      page:      Number(page),
      pages:     Math.ceil(total / limit),
      campaigns
    });
  } catch (error) {
    console.error('Error in getCampaignsByInfluencer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};