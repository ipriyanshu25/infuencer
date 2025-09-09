// controllers/brandController.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const Brand = require('../models/brand');
const VerifyEmail = require('../models/verifyEmail');
const Country = require('../models/country');
const Milestone = require('../models/milestone'); 
const Subscription = require('../models/subscription'); // if used in subscriptionHelper
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

const exactEmailRegex = (email) => ({
  $regex: `^${String(email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
  $options: 'i'
});
const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;


exports.requestOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // Generate code & expiry
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert verification record (do NOT create a Brand yet)
    await VerifyEmail.findOneAndUpdate(
      { email: exactEmailRegex(email) },
      {
        $set: { email: email.trim(), otpCode: code, otpExpiresAt: expiresAt, verified: false, verifiedAt: null },
        $inc: { attempts: 1 }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Send OTP email
    await transporter.sendMail({
      from: `"No-Reply" <${SMTP_USER}>`,
      to: email,
      subject: 'Your verification code',
      text: `Your OTP is ${code}. It expires in 10 minutes.`
    });

    return res.json({ message: 'OTP sent to email' });
  } catch (err) {
    console.error('Error in requestOtp:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * 2) Verify OTP (email verification) — now uses VerifyEmail model
 * POST /brand/otp/verify
 * Body: { email, otp }
 */
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || otp == null) {
      return res.status(400).json({ message: 'Email and otp required' });
    }

    const doc = await VerifyEmail.findOne({
      email: exactEmailRegex(email),
      otpCode: otp.toString().trim(),
      otpExpiresAt: { $gt: new Date() }
    });

    if (!doc) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Mark verified and clear OTP values
    doc.verified = true;
    doc.verifiedAt = new Date();
    doc.otpCode = undefined;
    doc.otpExpiresAt = undefined;
    await doc.save();

    return res.json({ message: 'OTP verified' });
  } catch (err) {
    console.error('Error in verifyOtp:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * 3) Complete registration — now checks VerifyEmail instead of Brand.otpVerified
 * POST /brand/register
 * Body: { name, email, password, phone, countryId, callingId }
 */
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, countryId, callingId } = req.body;
    if (!name || !email || !password || !phone || !countryId || !callingId) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Must be verified via VerifyEmail
    const emailDoc = await VerifyEmail.findOne({ email: exactEmailRegex(email), verified: true });
    if (!emailDoc) {
      return res.status(400).json({ message: 'Email not verified' });
    }

    // Prevent duplicate registration
    const existing = await Brand.findOne({ email: exactEmailRegex(email) });
    if (existing) {
      return res.status(400).json({ message: 'Brand already registered' });
    }

    // Validate country IDs
    const countryDoc = await Country.findById(countryId);
    const callingDoc = await Country.findById(callingId);
    if (!countryDoc || !callingDoc) {
      return res.status(400).json({ message: 'Invalid country or calling code' });
    }

    // Create brand
    const brand = new Brand({
      name,
      email: email.trim(),
      password,
      phone,
      county: countryDoc.countryName,     // preserving your original field name "county"
      callingcode: callingDoc.callingCode,
      countryId,
      callingId
    });

    // Assign subscription
    const freePlan = await subscriptionHelper.getFreePlan('Brand');
    if (freePlan) {
      const expires = subscriptionHelper.computeExpiry(freePlan);
      brand.subscription = {
        planId: freePlan.planId,
        planName: freePlan.name,
        startedAt: new Date(),
        expiresAt: expires,
        features: (freePlan.features || []).map(f => ({
          key: f.key,
          limit: typeof f.value === 'number' ? f.value : 0,
          used: 0
        }))
      };
      brand.subscriptionExpired = false;
    }

    const saved = await brand.save();

    // Optional: keep VerifyEmail document as an audit trail, or delete it.
    // await VerifyEmail.deleteOne({ email: exactEmailRegex(email) });

    return res.status(201).json({ message: 'Registration complete', brand: saved });
  } catch (error) {
    console.error('Error in register:', error);
    return res.status(500).json({ message: 'Internal server error during registration' });
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
      email: exactEmailRegex(email)
    });
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    // 2) If account is locked, block login
    const now = new Date();
    if (brand.lockUntil && brand.lockUntil > now) {
      const msLeft = brand.lockUntil.getTime() - now.getTime();
      const minutesLeft = Math.ceil(msLeft / (60 * 1000));
      return res.status(403).json({
        message: 'Account locked due to multiple failed login attempts. Try again after the lock period.',
        lockUntil: brand.lockUntil,
        minutesLeft
      });
    }

    // 3) Compare provided password with hashed password
    const isMatch = await brand.comparePassword(password);

    if (!isMatch) {
      // Wrong password → increment attempts
      brand.failedLoginAttempts = (brand.failedLoginAttempts || 0) + 1;

      if (brand.failedLoginAttempts >= 3) {
        // Lock for 24 hours from *this* incorrect attempt
        const LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
        brand.lockUntil = new Date(Date.now() + LOCK_WINDOW_MS);
      }

      await brand.save();

      if (brand.lockUntil && brand.lockUntil > now) {
        return res.status(403).json({
          message: 'Too many failed attempts. Account locked for 24 hours.',
          lockUntil: brand.lockUntil
        });
      }

      const attemptsLeft = Math.max(0, 3 - brand.failedLoginAttempts);
      return res.status(400).json({
        message: 'Invalid credentials',
        attemptsLeft
      });
    }

    // 4) Correct password & not locked → reset counters
    if (brand.failedLoginAttempts || brand.lockUntil) {
      brand.failedLoginAttempts = 0;
      brand.lockUntil = null;
      await brand.save();
    }

    // 5) Generate JWT (expires in 100 days)
    const token = jwt.sign(
      { brandId: brand.brandId, email: brand.email },
      JWT_SECRET,
      { expiresIn: '100d' }
    );

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

/**
 * POST /brand/password/reset/request
 * Body: { email }
 */
exports.requestPasswordResetOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // Find registered brand (must have name + password set)
    const brand = await Brand.findOne({
      email: exactEmailRegex(email),
      name: { $exists: true, $ne: null },
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
  } catch (err) {
    console.error('Error in requestPasswordResetOtp:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * POST /brand/password/reset/verify
 * Body: { email, otp }
 * Verifies OTP & returns a short-lived reset token.
 */
exports.verifyPasswordResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || otp == null) {
      return res.status(400).json({ message: 'Email and otp required' });
    }

    const brand = await Brand.findOne({
      email: exactEmailRegex(email),
      passwordResetCode: otp.toString().trim(),
      passwordResetExpiresAt: { $gt: new Date() }
    });

    if (!brand) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    brand.passwordResetVerified = true;
    // optional: clear code now to prevent reuse
    brand.passwordResetCode = undefined;
    brand.passwordResetExpiresAt = undefined;
    await brand.save();

    // Issue short-lived JWT authorizing password reset
    const resetToken = jwt.sign(
      { brandId: brand.brandId, email: brand.email, prt: true }, // prt=password reset token
      JWT_SECRET,
      { expiresIn: '100d' } // keeping your existing duration
    );

    return res.status(200).json({ message: 'OTP verified', resetToken });
  } catch (err) {
    console.error('Error in verifyPasswordResetOtp:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
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

    if (!brand.passwordResetVerified) {
      return res.status(400).json({ message: 'Password reset not verified' });
    }

    // set new password (pre-save hook will hash)
    brand.password = newPassword;

    // ✅ CLEAR lock & attempts so user can log in immediately
    brand.failedLoginAttempts = 0;
    brand.lockUntil = null;

    // clear the flag so reset flow can't be reused
    brand.passwordResetVerified = false;

    await brand.save();

    return res.status(200).json({ message: 'Password reset successful. You can log in now.' });
  } catch (err) {
    console.error('Error in resetPassword:', err);
    return res.status(403).json({ message: 'Invalid or expired reset token' });
  }
};

const delay = ms => new Promise(res => setTimeout(res, ms));

/**
 * POST /brand/search
 * Body: { search, influencerId }
 * Requires influencer auth middleware that sets req.influencer.{influencerId}
 */
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


// controllers/brandController.js

exports.updateProfile = async (req, res) => {
  try {
    // read brandId from body
    const { brandId, name, phone, countryId, callingId } = req.body || {};

    if (!brandId) {
      return res.status(400).json({ message: 'brandId is required' });
    }

    // OPTIONAL: if you still use verifyToken, ensure the body brandId matches the token
    if (req.brand && req.brand.brandId && req.brand.brandId !== brandId) {
      return res.status(403).json({ message: 'Forbidden: brandId mismatch' });
    }

    // require at least one change
    if (
      name == null &&
      phone == null &&
      countryId == null &&
      callingId == null
    ) {
      return res.status(400).json({ message: 'No changes provided' });
    }

    const brand = await Brand.findOne({ brandId });
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    if (name != null) brand.name = String(name).trim();
    if (phone != null) brand.phone = String(phone).trim();

    if (countryId) {
      const countryDoc = await Country.findById(countryId);
      if (!countryDoc) return res.status(400).json({ message: 'Invalid countryId' });
      brand.countryId = countryId;
      brand.county = countryDoc.countryName; // your original field name
    }

    if (callingId) {
      const callingDoc = await Country.findById(callingId);
      if (!callingDoc) return res.status(400).json({ message: 'Invalid callingId' });
      brand.callingId = callingId;
      brand.callingcode = callingDoc.callingCode;
    }

    await brand.save();

    const safe = brand.toObject();
    delete safe.password;
    delete safe._id;
    delete safe.__v;

    return res.status(200).json({ message: 'Profile updated', brand: safe });
  } catch (err) {
    console.error('Error in updateProfile:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


exports.requestEmailUpdate = async (req, res) => {
  try {
    const { brandId, newEmail } = req.body || {};

    if (!brandId) {
      return res.status(400).json({ message: 'brandId is required' });
    }
    // OPTIONAL: if using verifyToken middleware, ensure token matches body
    if (req.brand && req.brand.brandId && req.brand.brandId !== brandId) {
      return res.status(403).json({ message: 'Forbidden: brandId mismatch' });
    }

    if (!newEmail || !emailRegex.test(String(newEmail).trim())) {
      return res.status(400).json({ message: 'Valid newEmail is required' });
    }

    const brand = await Brand.findOne({ brandId });
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    const oldEmail = brand.email.trim();
    const nextEmail = String(newEmail).trim();

    if (oldEmail.toLowerCase() === nextEmail.toLowerCase()) {
      return res.status(400).json({ message: 'New email cannot be the same as current email' });
    }

    // Ensure newEmail not used by any other brand
    const taken = await Brand.findOne({
      email: exactEmailRegex(nextEmail),
      brandId: { $ne: brandId }
    });
    if (taken) return res.status(409).json({ message: 'Email already in use' });

    // Generate OTPs and expiry
    const oldOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // OLD email: ensure a VerifyEmail doc exists; mark verified (it already was),
    // then set a fresh OTP for confirmation
    await VerifyEmail.findOneAndUpdate(
      { email: exactEmailRegex(oldEmail) },
      {
        $setOnInsert: { email: oldEmail, verified: true, verifiedAt: new Date() },
        $set: { otpCode: oldOtp, otpExpiresAt: expiresAt },
        $inc: { attempts: 1 }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // NEW email: upsert, force verified=false until confirmed, set OTP
    await VerifyEmail.findOneAndUpdate(
      { email: exactEmailRegex(nextEmail) },
      {
        $set: { email: nextEmail, verified: false, verifiedAt: null, otpCode: newOtp, otpExpiresAt: expiresAt },
        $inc: { attempts: 1 }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Send both OTPs
    await transporter.sendMail({
      from: `"No-Reply" <${SMTP_USER}>`,
      to: oldEmail,
      subject: 'Confirm email change (old email verification)',
      text: `Your OTP to confirm changing away from this email is ${oldOtp}. It expires in 10 minutes.`
    });

    await transporter.sendMail({
      from: `"No-Reply" <${SMTP_USER}>`,
      to: nextEmail,
      subject: 'Confirm email change (new email verification)',
      text: `Your OTP to confirm using this as your new email is ${newOtp}. It expires in 10 minutes.`
    });

    return res.status(200).json({ message: 'OTPs sent to old and new emails' });
  } catch (err) {
    console.error('Error in requestEmailUpdate:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// =================== POST /brand/email/update/verify ===================
/**
 * Body: { brandId, newEmail, oldOtp, newOtp }
 * - Validate both OTPs (old & new) via VerifyEmail
 * - Update Brand.email -> newEmail
 * - VerifyEmail(oldEmail).verified = false (clear OTPs)
 * - VerifyEmail(newEmail).verified = true (clear OTPs, set verifiedAt)
 * - Return fresh JWT
 */
exports.verifyEmailUpdate = async (req, res) => {
  try {
    const { brandId, newEmail, oldOtp, newOtp } = req.body || {};

    if (!brandId) {
      return res.status(400).json({ message: 'brandId is required' });
    }
    // OPTIONAL: if using verifyToken middleware, ensure token matches body
    if (req.brand && req.brand.brandId && req.brand.brandId !== brandId) {
      return res.status(403).json({ message: 'Forbidden: brandId mismatch' });
    }

    if (!newEmail || !emailRegex.test(String(newEmail).trim())) {
      return res.status(400).json({ message: 'Valid newEmail is required' });
    }
    if (!oldOtp || !newOtp) {
      return res.status(400).json({ message: 'Both oldOtp and newOtp are required' });
      }

    const brand = await Brand.findOne({ brandId });
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    const oldEmail = brand.email.trim();
    const nextEmail = String(newEmail).trim();

    // 1) Check OTP for old email
    const oldDoc = await VerifyEmail.findOne({
      email: exactEmailRegex(oldEmail),
      otpCode: oldOtp.toString().trim(),
      otpExpiresAt: { $gt: new Date() }
    });
    if (!oldDoc) {
      return res.status(400).json({ message: 'Invalid or expired OTP for old email' });
    }

    // 2) Check OTP for new email
    const newDoc = await VerifyEmail.findOne({
      email: exactEmailRegex(nextEmail),
      otpCode: newOtp.toString().trim(),
      otpExpiresAt: { $gt: new Date() }
    });
    if (!newDoc) {
      return res.status(400).json({ message: 'Invalid or expired OTP for new email' });
    }

    // 3) Make sure no other brand owns that new email
    const taken = await Brand.findOne({
      email: exactEmailRegex(nextEmail),
      brandId: { $ne: brandId }
    });
    if (taken) return res.status(409).json({ message: 'Email already in use' });

    // 4) Update Brand email
    brand.email = nextEmail;
    await brand.save();

    // 5) Flip verification flags and clear OTPs
    oldDoc.verified = false;
    oldDoc.verifiedAt = null;
    oldDoc.otpCode = undefined;
    oldDoc.otpExpiresAt = undefined;
    await oldDoc.save();

    newDoc.verified = true;
    newDoc.verifiedAt = new Date();
    newDoc.otpCode = undefined;
    newDoc.otpExpiresAt = undefined;
    await newDoc.save();

    // 6) Fresh JWT reflecting new email
    const token = jwt.sign(
      { brandId: brand.brandId, email: brand.email },
      JWT_SECRET,
      { expiresIn: '100d' }
    );

    return res.status(200).json({ message: 'Email updated successfully', email: brand.email, token });
  } catch (err) {
    console.error('Error in verifyEmailUpdate:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};