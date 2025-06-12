// controllers/influencerController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Influencer = require('../models/influencer');
const Country = require('../models/country');
const Interest = require('../models/interest');
const Campaign = require('../models/campaign'); 
const AudienceRange = require('../models/audience');

const JWT_SECRET = process.env.JWT_SECRET;

// Register a new influencer
exports.register = async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    socialMedia,
    categoryId,      // ← now a reference to Interest
    audienceId,      // ← new: reference to AudienceRange
    countryId,       // ← reference to Country
    callingId,       // ← reference to Country for calling code
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

    if (!interestDoc) {
      return res.status(400).json({ message: 'Invalid interest/category ID' });
    }
    if (!audienceDoc) {
      return res.status(400).json({ message: 'Invalid audience range ID' });
    }
    if (!countryDoc) {
      return res.status(400).json({ message: 'Invalid country ID' });
    }
    if (!callingDoc) {
      return res.status(400).json({ message: 'Invalid calling code ID' });
    }

    // 3. Derive human-readable fields
    const categoryName   = interestDoc.name;          // assuming Interest schema has `name`
    const audienceRange  = audienceDoc.range;         // assuming AudienceRange schema has `range`
    const countryName    = countryDoc.countryName;
    const callingCode    = callingDoc.callingCode;

    // 4. Create and save
    const newInfluencer = new Influencer({
      name,
      email,
      password,           // will be hashed by pre-save hook
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

    await newInfluencer.save();

    return res.status(201).json({ message: 'Influencer registered successfully' });
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
    const influencer = await Influencer.findOne({ email });
    if (!influencer) {
      return res.status(404).json({ message: 'Influencer not found' });
    }
    const isMatch = await influencer.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { influencerId: influencer.influencerId, email: influencer.email },
      JWT_SECRET,
      { expiresIn: '100d' }
    );

    res.status(200).json({
      message: 'Login successful',
      influencerId: influencer.influencerId,
      categoryId: influencer.categoryId,
      token
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
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

// Get a single influencer by influencerId (via query param ?influencerId=...)
exports.getById = async (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ message: 'influencerId query parameter is required' });
  }
  try {
    const influencer = await Influencer.findOne(
      { influencerId: id },
      '-password -__v'
    );
    if (!influencer) {
      return res.status(404).json({ message: 'Influencer not found' });
    }
    return res.status(200).json(influencer);
  } catch (error) {
    console.error('Error fetching influencer by ID:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
