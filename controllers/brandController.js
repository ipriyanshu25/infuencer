require('dotenv').config();
const jwt = require('jsonwebtoken');
const Brand = require('../models/brand');
const Country = require('../models/country');
const Milestone = require('../models/milestone');
const Subscription = require('../models/subscription'); // <-- your plan model
const subscriptionHelper = require('../utils/subscriptionHelper');
const JWT_SECRET = process.env.JWT_SECRET;


exports.register = async (req, res) => {
  const { name, email, password, phone, countryId, callingId } = req.body;
  try {
    // 1) Check email uniqueness
    if (await Brand.exists({ email })) {
      return res.status(400).json({ message: 'Brand already exists' });
    }

    // 2) Validate country & calling code
    const countryDoc = await Country.findById(countryId);
    const callingDoc = await Country.findById(callingId);
    if (!countryDoc || !callingDoc) {
      return res.status(400).json({ message: 'Invalid country or calling code ID' });
    }

    // 3) Create brand (subscription sub-doc gets defaults)
    const newBrand = new Brand({
      name,
      email,
      password, // will be hashed by pre-save hook
      phone,
      county: countryDoc.countryName,
      callingcode: callingDoc.callingCode,
      countryId,
      callingId
    });

    // 4) Initial save to get subscription defaults
    let savedBrand = await newBrand.save();

    // 5) Assign default free/baseline plan
    const freePlan = await subscriptionHelper.getFreePlan('Brand');
    if (freePlan) {
      const expires = subscriptionHelper.computeExpiry(freePlan);
      const featuresSnapshot = freePlan.features.map(f => ({
        key:   f.key,
        limit: typeof f.value === 'number' ? f.value : 0,
        used:  0
      }));

      savedBrand.subscription = {
        planId:    freePlan.planId,
        planName:  freePlan.name,
        startedAt: new Date(),
        expiresAt: expires,
        features:  featuresSnapshot
      };
      savedBrand.subscriptionExpired = false;
      await savedBrand.save();
    }

    // 6) Respond
    return res.status(201).json({
      message: 'Brand registered successfully',
      brand:   savedBrand
    });
  } catch (error) {
    console.error('Error in register:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


/**
 * Login an existing brand
 * POST /brand/login
 */
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1) Find brand by email, case-insensitive
    const brand = await Brand.findOne({
      email: { $regex: `^${email.trim()}$`, $options: 'i' }
    });
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    // 2) Compare provided password with hashed password
    const isMatch = await brand.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    // 3) Generate JWT (expires in 100 days)
    const token = jwt.sign(
      { brandId: brand.brandId, email: brand.email },
      JWT_SECRET,
      { expiresIn: '100d' }
    );

    // 4) Return token
    return res.status(200).json({
      message: 'Login successful',
      brandId: brand.brandId,
      token
    });
  } catch (error) {
    console.error('Error in brand.login:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Verify JWT middleware
 */
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(403).json({ message: 'Token required' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(403).json({ message: 'Token required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.brand = decoded;
    next();
  });
};

/**
 * GET /brand/getById?id=<brandId>
 */
exports.getBrandById = async (req, res) => {
  try {
    const brandId = req.query.id;
    if (!brandId) return res.status(400).json({ message: 'Query parameter id is required.' });

    // exclude password, internal fields
    const brandDoc = await Brand.findOne({ brandId })
      .select('-password -_id -__v')
      .lean();
    if (!brandDoc) return res.status(404).json({ message: 'Brand not found.' });

    // fetch wallet balance
    const milestoneDoc = await Milestone.findOne({ brandId }).lean();
    const walletBalance = milestoneDoc ? milestoneDoc.walletBalance : 0;

    return res.status(200).json({ ...brandDoc, walletBalance });
  } catch (error) {
    console.error('Error in getBrandById:', error);
    return res.status(500).json({ message: 'Internal server error while fetching brand.' });
  }
};

/**
 * GET /brand/all
 */
exports.getAllBrands = async (req, res) => {
  try {
    const brands = await Brand.find()
      .select('-password -_id -__v')
      .lean();
    return res.status(200).json({ brands });
  } catch (error) {
    console.error('Error in getAllBrands:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
