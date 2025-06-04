// controllers/brandController.js

const jwt   = require('jsonwebtoken');
const Brand = require('../models/brand');
const Country = require('../models/country');

// Retrieve JWT_SECRET from environment variables
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Register a new brand
 * POST /brand/register
 */
exports.register = async (req, res) => {
  const { name, email, password, phone, countryId,callingId } = req.body;

  try {
    // 1. Check if a brand with this email already exists
    const existingBrand = await Brand.findOne({ email });
    if (existingBrand) {
      return res.status(400).json({ message: 'Brand already exists' });
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
    // Extract the human‐readable name
    const countryName = countryDoc.countryName;
    const callingCode = callingDoc.callingCode; // Assuming you want to store this too

    // 3. Create a new Brand, storing the countryName (not the ObjectId)
    const newBrand = new Brand({
      name,
      email,
      password,       // hashed by your pre-save hook
      phone,
      county: countryName,
      callingcode: callingCode, // Store the calling code like "+1"
      countryId: countryId, // Store the ObjectId for reference
      callingId: callingId // Store the calling code ObjectId
    });

    // 4. Save to database
    await newBrand.save();

    // 5. Respond with success
    return res.status(201).json({
      message: 'Brand registered successfully'
    })
  } catch (error) {
    console.error('Error in brand.register:', error);
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
    // 1. Find brand by email
    const brand = await Brand.findOne({ email });
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    // 2. Compare provided password with hashed password
    const isMatch = await brand.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // 3. Generate a signed JWT (expires in 1 hour)
    const token = jwt.sign(
      { brandId: brand.brandId, email: brand.email },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 4. Return token
    return res.status(200).json({
      message: 'Login successful',
      token
    });
  } catch (error) {
    console.error('Error in brand.login:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.verifyToken = (req, res, next) => {
  // Expect header: Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(403).json({ message: 'Token required' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(403).json({ message: 'Token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    // decoded = { brandId: "...", email: "...", iat: ..., exp: ... }
    req.brand = decoded;
    next();
  });
};