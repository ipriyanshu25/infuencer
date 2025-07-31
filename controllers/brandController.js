require('dotenv').config();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Brand = require('../models/brand');
const Country = require('../models/country');
const Milestone = require('../models/milestone');
const Subscription = require('../models/subscription'); // <-- your plan model
const subscriptionHelper = require('../utils/subscriptionHelper');


const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const JWT_SECRET = process.env.JWT_SECRET;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// 1) Request OTP
exports.requestOtp = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  // generate code & expiry
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // upsert brand record’s OTP fields
  const brand = await Brand.findOneAndUpdate(
    { email },
    { otpCode: code, otpExpiresAt: expiresAt, otpVerified: false },
    { new: true }
  );
  if (!brand) {
    // if no brand yet, create a temp record with email only
    await new Brand({ email, otpCode: code, otpExpiresAt: expiresAt }).save();
  }

  // send OTP email
  await transporter.sendMail({
    from: `"No-Reply" <${SMTP_USER}>`,
    to: email,
    subject: 'Your verification code',
    text: `Your OTP is ${code}. It expires in 10 minutes.`
  });

  res.json({ message: 'OTP sent to email' });
};

// 2) Verify OTP
exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || otp == null) {
    return res.status(400).json({ message: 'Email and otp required' });
  }

  // atomically check code + expiry
  const result = await Brand.findOneAndUpdate(
    {
      email,
      otpCode: otp.toString().trim(),
      otpExpiresAt: { $gt: new Date() }
    },
    {
      $set: { 
        otpVerified: true,
        // optionally clear the code so it can’t be reused:
        otpCode: undefined,
        otpExpiresAt: undefined
      }
    },
    { new: true, runValidators: false }
  );

  if (!result) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }

  return res.json({ message: 'OTP verified' });
};

// 3) Complete registration
exports.register = async (req, res) => {
  const { name, email, password, phone, countryId, callingId } = req.body;
  if (!name || !email || !password || !phone || !countryId || !callingId) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  // fetch brand (must have otpVerified)
  const brand = await Brand.findOne({ email });
  if (!brand || !brand.otpVerified) {
    return res.status(400).json({ message: 'Email not verified' });
  }
  if (brand.name) {
    return res.status(400).json({ message: 'Brand already registered' });
  }

  // validate country IDs
  const countryDoc = await Country.findById(countryId);
  const callingDoc = await Country.findById(callingId);
  if (!countryDoc || !callingDoc) {
    return res.status(400).json({ message: 'Invalid country or calling code' });
  }

  // fill in the rest of fields
  brand.name        = name;
  brand.password    = password;
  brand.phone       = phone;
  brand.county      = countryDoc.countryName;
  brand.callingcode = callingDoc.callingCode;
  brand.countryId   = countryId;
  brand.callingId   = callingId;

  // assign subscription
  const freePlan = await subscriptionHelper.getFreePlan('Brand');
  if (freePlan) {
    const expires = subscriptionHelper.computeExpiry(freePlan);
    brand.subscription = {
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
    brand.subscriptionExpired = false;
  }

  // clear OTP fields
  brand.otpCode      = undefined;
  brand.otpExpiresAt = undefined;
  brand.otpVerified  = true;  // keep as proof

  const saved = await brand.save();
  res.status(201).json({ message: 'Registration complete', brand: saved });
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



exports.requestPasswordResetOtp = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  // Find registered brand (must have name + password set)
  const brand = await Brand.findOne({
    email: { $regex: `^${email.trim()}$`, $options: 'i' },
    name: { $exists: true, $ne: null }, // indicates completed registration
    password: { $exists: true, $ne: null }
  });

  // Security-choice: respond generic even if not found.
  if (!brand) {
    return res
      .status(200)
      .json({ message: 'If an account with that email exists, an OTP has been sent.' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  brand.passwordResetCode = code;
  brand.passwordResetExpiresAt = expiresAt;
  brand.passwordResetVerified = false;
  await brand.save();

  await transporter.sendMail({
    from: `"No-Reply" <${SMTP_USER}>`,
    to: brand.email,
    subject: 'Password reset code',
    text: `Your password reset OTP is ${code}. It expires in 10 minutes.`
  });

  return res
    .status(200)
    .json({ message: 'If an account with that email exists, an OTP has been sent.' });
};


/**
 * POST /brand/password/reset/verify
 * Body: { email, otp }
 * Verifies OTP & returns a short-lived reset token.
 */
exports.verifyPasswordResetOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || otp == null) {
    return res.status(400).json({ message: 'Email and otp required' });
  }

  const brand = await Brand.findOne({
    email: { $regex: `^${email.trim()}$`, $options: 'i' },
    passwordResetCode: otp.toString().trim(),
    passwordResetExpiresAt: { $gt: new Date() }
  });

  if (!brand) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }

  brand.passwordResetVerified = true;
  // optional: clear code now to prevent reuse
  // (if you clear, keep a flag so you know it was verified)
  // If you prefer to keep until reset completes, comment next two lines.
  brand.passwordResetCode = undefined;
  brand.passwordResetExpiresAt = undefined;
  await brand.save();

  // Issue short-lived JWT authorizing password reset
  const resetToken = jwt.sign(
    { brandId: brand.brandId, email: brand.email, prt: true }, // prt=password reset token
    JWT_SECRET,
    { expiresIn: '100d' }
  );

  return res.status(200).json({ message: 'OTP verified', resetToken });
};


/**
 * POST /brand/password/reset/complete
 * Body: { resetToken, newPassword, confirmPassword? }
 * Requires resetToken from verify step.
 */

exports.resetPassword = async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;
  if (!resetToken || !newPassword) {
    return res.status(400).json({ message: 'resetToken and newPassword required' });
  }
  if (confirmPassword != null && confirmPassword !== newPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const decoded = jwt.verify(resetToken, JWT_SECRET);
    if (!decoded.prt) {
      return res.status(403).json({ message: 'Invalid reset token' });
    }

    const brand = await Brand.findOne({ brandId: decoded.brandId });
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    // optional: ensure passwordResetVerified was true (defense in depth)
    if (!brand.passwordResetVerified) {
      return res.status(400).json({ message: 'Password reset not verified' });
    }

    brand.password = newPassword; // will hash via pre-save hook
    brand.passwordResetVerified = false; // clear flag
    await brand.save();

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Error in resetPassword:', err);
    return res.status(403).json({ message: 'Invalid or expired reset token' });
  }
};



const delay = ms => new Promise(res => setTimeout(res, ms));

exports.searchBrands = async (req, res) => {
  try {
    const requester = req.influencer;  
    const { search, influencerId } = req.body || {};

    // 1) Validate inputs
    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required' });
    }
    // ensure the token’s influencerId matches the body
    if (!requester || requester.influencerId !== influencerId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!search || !String(search).trim()) {
      return res.status(400).json({ message: 'search is required' });
    }


    await delay(300);

    const regex = new RegExp(search.trim(), 'i');
    const docs = await Brand
      .find({ name: regex }, 'name brandId')
      .limit(10)
      .lean();

    if (!docs || docs.length === 0) {
      return res.status(404).json({ message: 'No brands found' });
    }


    const results = docs.map(d => ({
      name: d.name,
      brandId: d.brandId
    }));

    return res.json({ results });
  } catch (err) {
    console.error('Error in searchBrands:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
