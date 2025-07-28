// controllers/influencerController.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const Influencer = require('../models/influencer');
const Interest = require('../models/interest');
const AudienceRange = require('../models/audience');
const Country = require('../models/country');
const subscriptionHelper = require('../utils/subscriptionHelper');
const Platform = require('../models/platform');         // social‐media platforms
const Audience = require('../models/audienceRange');


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

/**
 * STEP 1: Request OTP
 * POST /influencer/request-otp
 * Body: { email }
 */

const uploadDir = path.join(__dirname, '../uploads/profile_images');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// then your storage setup can simply point at uploadDir:
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only JPEG, JPG, and PNG files are allowed'));
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB limit
});

exports.uploadProfileImage = upload.single('profileImage');


exports.requestOtpInfluencer = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // upsert so we can save an email-only doc first
  await Influencer.findOneAndUpdate(
    { email },
    {
      $set: {
        otpCode: code,
        otpExpiresAt: expiresAt,
        otpVerified: false
      }
    },
    { upsert: true, new: true }
  );

  await transporter.sendMail({
    from: `"No-Reply" <${SMTP_USER}>`,
    to: email,
    subject: 'Verify Influencer',
    text: `Your verification code is ${code}. It expires in 10 minutes.`
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
// controllers/influencerController.js
exports.registerInfluencer = async (req, res) => {
  try {
    // 0) ensure profile image uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'Profile image is required' });
    }

    // 1) pull fields out of form-data
    let {
      name,
      email,
      password,
      phone,
      socialMedia,
      gender,                   // "0", "1" or "2"
      platformId,
      manualPlatformName,       // only if platform === Other
      profileLink,
      malePercentage,
      femalePercentage,
      categories,               // JSON string or Array of Interest _ids
      audienceAgeRangeId,       // UUID on Audience
      audienceId,               // ObjectId of AudienceRange
      countryId,
      callingId,
      bio
    } = req.body;

    // 1a) parse categories if it's a string
    if (typeof categories === 'string') {
      try {
        categories = JSON.parse(categories);
      } catch {
        return res.status(400).json({ message: 'categories must be a JSON array' });
      }
    }

    // 2) find influencer record & check OTP
    const inf = await Influencer.findOne({
      email: { $regex: `^${email.trim()}$`, $options: 'i' }
    });
    if (!inf || !inf.otpVerified) {
      return res.status(400).json({ message: 'Email not verified' });
    }
    if (inf.name) {
      return res.status(400).json({ message: 'Already registered' });
    }

    // 3) resolve & possibly create Platform
    let platformDoc = await Platform.findOne({ platformId });
    if (!platformDoc) {
      return res.status(400).json({ message: 'Invalid platformId' });
    }
    if (platformDoc.name === 'Other') {
      if (!manualPlatformName?.trim()) {
        return res.status(400).json({
          message: 'manualPlatformName is required when platform is Other'
        });
      }
      platformDoc = await new Platform({ name: manualPlatformName.trim() }).save();
    }

    // 4) validate categories array length & existence
    if (!Array.isArray(categories) || categories.length < 1 || categories.length > 3) {
      return res.status(400).json({
        message: 'You must select between 1 and 3 categories'
      });
    }
    const interestDocs = await Interest.find({ _id: { $in: categories } });
    if (interestDocs.length !== categories.length) {
      return res.status(400).json({ message: 'Invalid category IDs' });
    }

    // 5) resolve age-range, count-range, country & calling
    const [ageRangeDoc, countRangeDoc, countryDoc, callingDoc] = await Promise.all([
      Audience.findOne({ audienceId: audienceAgeRangeId }),
      AudienceRange.findById(audienceId),
      Country.findById(countryId),
      Country.findById(callingId)
    ]);
    if (!ageRangeDoc || !countRangeDoc || !countryDoc || !callingDoc) {
      return res.status(400).json({ message: 'Invalid reference IDs' });
    }

    // 6) assign all fields
    inf.name        = name;
    inf.password    = password;
    inf.phone       = phone;
    inf.socialMedia = socialMedia;
    inf.gender      = Number(gender);

    inf.platformId   = platformDoc._id;
    inf.platformName = platformDoc.name;

    inf.profileLink  = profileLink;
    inf.profileImage = `/uploads/profile_images/${req.file.filename}`;

    inf.audienceBifurcation = {
      malePercentage:   Number(malePercentage),
      femalePercentage: Number(femalePercentage)
    };

    inf.categories   = interestDocs.map(d => d._id);
    inf.categoryName = interestDocs.map(d => d.name);

    inf.audienceAgeRangeId = ageRangeDoc._id;
    inf.audienceAgeRange   = ageRangeDoc.range;

    inf.audienceId    = countRangeDoc._id;
    inf.audienceRange = countRangeDoc.range;

    inf.countryId   = countryId;
    inf.county      = countryDoc.countryName;
    inf.callingId   = callingId;
    inf.callingcode = callingDoc.callingCode;

    inf.bio = bio;

    // 7) assign free subscription
    const freePlan = await subscriptionHelper.getFreePlan('Influencer');
    if (freePlan) {
      inf.subscription = {
        planId:    freePlan.planId,
        planName:  freePlan.name,
        startedAt: new Date(),
        expiresAt: subscriptionHelper.computeExpiry(freePlan),
        features:  freePlan.features.map(f => ({
          key:   f.key,
          limit: typeof f.value === 'number' ? f.value : 0,
          used:  0
        }))
      };
      inf.subscriptionExpired = false;
    }

    // 8) save & respond
    await inf.save();
    return res.status(201).json({
      message:      'Influencer registered successfully',
      influencerId: inf.influencerId,
      subscription: inf.subscription
    });

  } catch (err) {
    console.error('Error in registerInfluencer:', err);
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
      message: 'Login successful',
      influencerId: influencer.influencerId,
      categoryId: influencer.categoryId,
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
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'    // 'asc' or 'desc'
    } = req.body;

    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required' });
    }

    // Build filter
    const filter = { influencerId };
    if (search.trim()) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);
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
      page: Number(page),
      pages: Math.ceil(total / limit),
      campaigns
    });
  } catch (error) {
    console.error('Error in getCampaignsByInfluencer:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};




exports.requestPasswordResetOtpInfluencer = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  // Find registered influencer (must have completed registration & password)
  const influencer = await Influencer.findOne({
    email: { $regex: `^${email.trim()}$`, $options: 'i' },
    name: { $exists: true, $ne: null },
    password: { $exists: true, $ne: null }
  });

  // Always respond generic (don’t leak whether account exists)
  if (!influencer) {
    return res.status(200).json({
      message: 'Email not exist'
    });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  influencer.passwordResetCode = code;
  influencer.passwordResetExpiresAt = expiresAt;
  influencer.passwordResetVerified = false;
  await influencer.save();

  await transporter.sendMail({
    from: `"No-Reply" <${SMTP_USER}>`,
    to: influencer.email,
    subject: 'Password reset code',
    text: `Your password reset OTP is ${code}. It expires in 10 minutes.`
  });

  return res.status(200).json({
    message: 'OTP has been sent.'
  });
};


/**
 * STEP B: Verify password reset OTP
 * POST /influencer/password/reset/verify
 * Body: { email, otp }
 *
 * On success returns a short-lived resetToken (JWT, ~15m).
 */
exports.verifyPasswordResetOtpInfluencer = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || otp == null) {
    return res.status(400).json({ message: 'Email and otp required' });
  }

  const influencer = await Influencer.findOne({
    email: { $regex: `^${email.trim()}$`, $options: 'i' },
    passwordResetCode: otp.toString().trim(),
    passwordResetExpiresAt: { $gt: new Date() }
  });

  if (!influencer) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }

  influencer.passwordResetVerified = true;
  // Clear the OTP so it cannot be reused
  influencer.passwordResetCode = undefined;
  influencer.passwordResetExpiresAt = undefined;
  await influencer.save();

  // Short-lived JWT authorizing password reset
  const resetToken = jwt.sign(
    { influencerId: influencer.influencerId, email: influencer.email, prt: true },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  return res.status(200).json({ message: 'OTP verified', resetToken });
};


/**
 * STEP C: Complete password reset
 * POST /influencer/password/reset/complete
 * Body: { resetToken, newPassword, confirmPassword? }
 *
 * Requires token from STEP B. Updates password (hashed via schema hook).
 */
exports.resetPasswordInfluencer = async (req, res) => {
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

    const influencer = await Influencer.findOne({ influencerId: decoded.influencerId });
    if (!influencer) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    // Defense in depth: confirm a verified reset happened
    if (!influencer.passwordResetVerified) {
      return res.status(400).json({ message: 'Password reset not verified' });
    }

    influencer.password = newPassword; // hashed via pre-save hook
    influencer.passwordResetVerified = false; // clear flag
    await influencer.save();

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Error in resetPasswordInfluencer:', err);
    return res.status(403).json({ message: 'Invalid or expired reset token' });
  }
};




exports.addPaymentMethod = async (req, res) => {
  try {
    const { influencerId } = req.influencer || {}; // from verifyToken
    const {
      type,            // 0 = PayPal, 1 = Bank
      bank = {},       // { accountHolder, accountNumber, ifsc, swift, bankName, branch, country }
      paypal = {},     // { email, paypalId }
      isDefault = false
    } = req.body;

    if (![0, 1].includes(Number(type))) {
      return res.status(400).json({ message: 'type must be 0 (PayPal) or 1 (Bank)' });
    }

    // Fetch influencer doc
    const inf = await Influencer.findOne({ influencerId });
    if (!inf) return res.status(404).json({ message: 'Influencer not found' });

    // Build payment object
    const paymentObj = {
      paymentId: uuidv4(),
      type: Number(type),
      bank: undefined,
      paypal: undefined,
      isDefault: Boolean(isDefault)
    };

    if (Number(type) === 1) {
      // Bank required fields
      const required = ['accountHolder', 'accountNumber', 'bankName'];
      for (const f of required) {
        if (!bank[f]?.trim()) {
          return res.status(400).json({ message: `Missing bank field: ${f}` });
        }
      }
      paymentObj.bank = {
        accountHolder: bank.accountHolder.trim(),
        accountNumber: bank.accountNumber.trim(),
        ifsc: bank.ifsc?.trim(),
        swift: bank.swift?.trim(),
        bankName: bank.bankName.trim(),
        branch: bank.branch?.trim(),
        country: bank.country?.trim()
      };
    } else {
      // PayPal required fields
      if (!paypal.email?.trim()) {
        return res.status(400).json({ message: 'paypal.email is required' });
      }
      paymentObj.paypal = {
        email: paypal.email.trim(),
        paypalId: paypal.paypalId?.trim()
      };
    }

    // If setting default, clear others
    if (paymentObj.isDefault) {
      inf.paymentMethods.forEach(pm => (pm.isDefault = false));
    } else {
      // If user has no payment methods yet, force first one as default
      if (inf.paymentMethods.length === 0) paymentObj.isDefault = true;
    }

    // Push and save
    inf.paymentMethods.push(paymentObj);
    await inf.save();

    return res.status(201).json({
      message: 'Payment method added',
      paymentId: paymentObj.paymentId,
      paymentMethods: inf.paymentMethods
    });
  } catch (err) {
    console.error('Error in addPaymentMethod:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};



exports.deletePaymentMethod = async (req, res) => {
  try {
    const { influencerId } = req.influencer || {};
    const { paymentId } = req.body;

    const inf = await Influencer.findOne({ influencerId });
    if (!inf) return res.status(404).json({ message: 'Influencer not found' });

    const idx = inf.paymentMethods.findIndex(pm => pm.paymentId === paymentId);
    if (idx === -1) return res.status(404).json({ message: 'Payment method not found' });

    const wasDefault = inf.paymentMethods[idx].isDefault;
    inf.paymentMethods.splice(idx, 1);

    // If we deleted default, mark first remaining as default (if any)
    if (wasDefault && inf.paymentMethods.length > 0) {
      inf.paymentMethods[0].isDefault = true;
    }

    await inf.save();
    return res.status(200).json({ message: 'Payment method deleted', paymentMethods: inf.paymentMethods });
  } catch (err) {
    console.error('Error in deletePaymentMethod:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


const mask = (val = '', keep = 4) =>
  val.length <= keep ? val : '*'.repeat(val.length - keep) + val.slice(-keep);

exports.viewPaymentByType = async (req, res) => {
  try {
    const requester = req.influencer;                 // from verifyToken
    const { influencerId, type } = req.body || {};

    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required' });
    }
    if (type === undefined || ![0, 1].includes(Number(type))) {
      return res.status(400).json({ message: 'type must be 0 (PayPal) or 1 (Bank)' });
    }

    // self-only (adjust for admin roles if needed)
    if (!requester || requester.influencerId !== influencerId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const inf = await Influencer.findOne(
      { influencerId },
      'paymentMethods influencerId'
    );
    if (!inf) return res.status(404).json({ message: 'Influencer not found' });

    // Filter by type
    let filtered = inf.paymentMethods.filter(pm => pm.type === Number(type));

    // Mask accountNumber for bank type
    if (Number(type) === 1) {
      filtered = filtered.map(pm => {
        const obj = pm.toObject();
        if (obj.bank?.accountNumber) {
          obj.bank.accountNumber = mask(obj.bank.accountNumber);
        }
        return obj;
      });
    }

    return res.status(200).json({
      influencerId: inf.influencerId,
      type: Number(type),
      paymentMethods: filtered
    });
  } catch (err) {
    console.error('Error in viewPaymentByType:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};



exports.updatePaymentMethod = async (req, res) => {
  try {
    const { influencerId } = req.influencer; // from verifyToken
    const {
      paymentId,
      type,                 // 0 = PayPal, 1 = Bank
      bank = {},            // fields to update if type === 1
      paypal = {},          // fields to update if type === 0
      isDefault             // optional boolean
    } = req.body || {};

    if (!paymentId) {
      return res.status(400).json({ message: 'paymentId is required' });
    }
    if (type === undefined || ![0, 1].includes(Number(type))) {
      return res.status(400).json({ message: 'type must be 0 (PayPal) or 1 (Bank)' });
    }

    const inf = await Influencer.findOne({ influencerId });
    if (!inf) return res.status(404).json({ message: 'Influencer not found' });

    const pm = inf.paymentMethods.find(p => p.paymentId === paymentId);
    if (!pm) return res.status(404).json({ message: 'Payment method not found' });

    pm.type = Number(type);

    if (pm.type === 1) {
      // Bank required fields
      const required = ['accountHolder', 'accountNumber', 'bankName'];
      for (const f of required) {
        const val = bank[f] !== undefined ? bank[f] : pm.bank?.[f];
        if (!val || !String(val).trim()) {
          return res.status(400).json({ message: `Missing bank field: ${f}` });
        }
      }
      pm.bank = {
        accountHolder: bank.accountHolder ?? pm.bank?.accountHolder,
        accountNumber: bank.accountNumber ?? pm.bank?.accountNumber,
        ifsc:          bank.ifsc ?? pm.bank?.ifsc,
        swift:         bank.swift ?? pm.bank?.swift,
        bankName:      bank.bankName ?? pm.bank?.bankName,
        branch:        bank.branch ?? pm.bank?.branch,
        country:       bank.country ?? pm.bank?.country
      };
      pm.paypal = undefined;
    } else {
      // PayPal required field
      const emailVal = paypal.email ?? pm.paypal?.email;
      if (!emailVal || !String(emailVal).trim()) {
        return res.status(400).json({ message: 'paypal.email is required' });
      }
      pm.paypal = {
        email: paypal.email ?? pm.paypal?.email,
        paypalId: paypal.paypalId ?? pm.paypal?.paypalId
      };
      pm.bank = undefined;
    }

    if (typeof isDefault === 'boolean') {
      if (isDefault) {
        inf.paymentMethods.forEach(x => (x.isDefault = false));
        pm.isDefault = true;
      } else {
        pm.isDefault = false;
        if (!inf.paymentMethods.some(x => x.isDefault)) {
          pm.isDefault = true; // keep at least one default
        }
      }
    }

    await inf.save();

    return res.status(200).json({
      message: 'Payment method updated',
      paymentMethod: pm,
      paymentMethods: inf.paymentMethods
    });
  } catch (err) {
    console.error('Error in updatePaymentMethod:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};