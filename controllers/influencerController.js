const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Influencer = require('../models/influencer');
const Country = require('../models/country');
const Interest = require('../models/interest');
const Campaign = require('../models/campaign'); 
const AudienceRange = require('../models/audience');
const subscriptionHelper = require('../utils/subscriptionHelper');
const JWT_SECRET = process.env.JWT_SECRET;

// Register a new influencer
exports.register = async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    socialMedia,
    categoryId,
    audienceId,
    countryId,
    callingId,
    bio
  } = req.body;

  try {
    // 1. Check if influencer already exists
    if (await Influencer.findOne({ email })) {
      return res.status(400).json({ message: 'Influencer already exists' });
    }

    // 2. Look up and validate all referenced docs
    const [interestDoc, audienceDoc, countryDoc, callingDoc] = await Promise.all([
      Interest.findById(categoryId),
      AudienceRange.findById(audienceId),
      Country.findById(countryId),
      Country.findById(callingId)
    ]);

    if (!interestDoc) return res.status(400).json({ message: 'Invalid interest/category ID' });
    if (!audienceDoc) return res.status(400).json({ message: 'Invalid audience range ID' });
    if (!countryDoc) return res.status(400).json({ message: 'Invalid country ID' });
    if (!callingDoc) return res.status(400).json({ message: 'Invalid calling code ID' });

    // 3. Derive human-readable fields
    const categoryName  = interestDoc.name;
    const audienceRange = audienceDoc.range;
    const countryName   = countryDoc.countryName;
    const callingCode   = callingDoc.callingCode;

    // 4. Create and save influencer
    const newInfluencer = new Influencer({
      name,
      email,
      password,
      phone,
      socialMedia,
      categoryId,
      categoryName,
      audienceId,
      audienceRange,
      countryId,
      county: countryName,
      callingId,
      callingcode: callingCode,
      bio
    });

    // Initial save to get base document and default subscription
    let savedInfluencer = await newInfluencer.save();

    // 5. Assign default free subscription
    const freePlan = await subscriptionHelper.getFreePlan('Influencer');
    if (freePlan) {
      const expires = subscriptionHelper.computeExpiry(freePlan);
      const featuresSnapshot = freePlan.features.map(f => ({
        key:   f.key,
        limit: typeof f.value === 'number' ? f.value : 0,
        used:  0
      }));

      savedInfluencer.subscription = {
        planId:    freePlan.planId,
        planName:  freePlan.name,
        startedAt: new Date(),
        expiresAt: expires,
        features:  featuresSnapshot
      };
      savedInfluencer.subscriptionExpired = false;
      await savedInfluencer.save();
    }

    // 6. Respond with created influencer
    return res.status(201).json({
      message: 'Influencer registered successfully',
      influencerId: savedInfluencer.influencerId,
      subscription: savedInfluencer.subscription
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
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
