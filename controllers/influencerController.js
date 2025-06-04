// controllers/influencerController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Influencer = require('../models/influencer');
const Country    = require('../models/country');

// Retrieve JWT_SECRET from environment variables
const JWT_SECRET = process.env.JWT_SECRET;

// Register a new influencer
exports.register = async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    socialMedia,
    audience,
    countryId,   // ← the frontend will now send `countryId`
    callingId,  // ← this is the calling code like "+1" for US
    bio
  } = req.body;

  try {
    // 1. Check if influencer already exists (by email)
    const existingInfluencer = await Influencer.findOne({ email });
    if (existingInfluencer) {
      return res.status(400).json({ message: 'Influencer already exists' });
    }

    // 2. Look up the country document by its _id
    const countryDoc = await Country.findById(countryId);
    const callingDoc = await Country.findById(callingId);
    if (!callingDoc) {
      return res.status(400).json({ message: 'Invalid calling code ID' });
    }
    if (!countryDoc) {
      return res.status(400).json({ message: 'Invalid country ID' });
    }
    // Grab the countryName from that document
    const countryName = countryDoc.countryName;
    const callingCode = callingDoc.callingCode; // Assuming you want to store this too

    // 3. Create new influencer, storing the countryName (not the ObjectId)
    const newInfluencer = new Influencer({
      name,
      email,
      password,       // assume your schema pre-save hook will hash this
      phone,
      socialMedia,
      audience,
      countryId: countryId, // ← store the ObjectId for reference
      callingId:callingId,      // ← store the calling code like "+1"
      county: countryName,  // ← store the human-readable name
      callingcode: callingCode, // ← store the calling code like "+1"
      bio
    });

    // 4. Save to DB
    await newInfluencer.save();

    return res.status(201).json({
      message: 'Influencer registered successfully'
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
        // Find influencer by email
        const influencer = await Influencer.findOne({ email });
        if (!influencer) {
            return res.status(404).json({ message: 'Influencer not found' });
        }

        // Compare passwords
        const isMatch = await influencer.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { influencerId: influencer.influencerId, email: influencer.email },
            JWT_SECRET, // Use the JWT_SECRET from the environment variable
            { expiresIn: '1d' } // Token expiration time (1 hour)
        );

        res.status(200).json({
            message: 'Login successful',
            influencerId: influencer.influencerId,
            token
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Middleware to verify JWT token (use in protected routes)
exports.verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'Token required' });
    }

    // Verify the token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.influencer = decoded; // Attach influencer details to the request object
        next();
    });
};


exports.getProfile = async (req, res) => {
  try {
    // verifyToken() has already run and set req.influencer = { influencerId, email, … }
    const { influencerId } = req.body;
    if (!influencerId) {
      return res.status(400).json({ message: 'Influencer ID is required' });
    }

    const influencer = await Influencer.findOne(
      { influencerId },
      '-password -_id -__v'
    );

    if (!influencer) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    res.status(200).json(influencer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
};