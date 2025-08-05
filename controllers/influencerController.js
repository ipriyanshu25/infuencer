require('dotenv').config();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const Influencer = require('../models/influencer');
const Interest = require('../models/interest');
const AudienceRange = require('../models/audience');
const Country = require('../models/country');
const subscriptionHelper = require('../utils/subscriptionHelper');
const Platform = require('../models/platform');
const Audience = require('../models/audienceRange');
const Campaign = require('../models/campaign');

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

const uploadDir = path.join(__dirname, '../uploads/profile_images');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
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
  limits: { fileSize: 2 * 1024 * 1024 }
});

exports.uploadProfileImage = upload.single('profileImage');

// Request OTP (upsert, now defensive)
exports.requestOtpInfluencer = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
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
  } catch (err) {
    if (err.code === 11000) {
      console.error('Duplicate key during OTP upsert:', err.message);
      return res.status(409).json({ message: 'Conflict while creating/updating influencer record.' });
    }
    console.error('Error in requestOtpInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }

  try {
    await transporter.sendMail({
      from: `"No-Reply" <${SMTP_USER}>`,
      to: email,
      subject: 'Verify Influencer',
      text: `Your verification code is ${code}. It expires in 10 minutes.`
    });
  } catch (mailErr) {
    console.warn('Failed to send OTP email:', mailErr.message);
  }

  res.json({ message: 'OTP sent to email' });
};


exports.verifyOtpInfluencer = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || otp == null) {
    return res.status(400).json({ message: 'Email and otp required' });
  }

  try {
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
    return res.json({ message: 'Email verified — you may now complete registration' });
  } catch (err) {
    console.error('Error in verifyOtpInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.registerInfluencer = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Profile image is required' });
    }

    let {
      name,
      email,
      password,
      phone,
      socialMedia,
      gender,
      platformId,
      manualPlatformName,
      profileLink,
      malePercentage,
      femalePercentage,
      categories,
      audienceAgeRangeId,
      audienceId,
      countryId,
      callingId,
      bio
    } = req.body;

    if (typeof categories === 'string') {
      try {
        categories = JSON.parse(categories);
      } catch {
        return res.status(400).json({ message: 'categories must be a JSON array' });
      }
    }

    const inf = await Influencer.findOne({
      email: { $regex: `^${email.trim()}$`, $options: 'i' }
    });
    if (!inf || !inf.otpVerified) {
      return res.status(400).json({ message: 'Email not verified' });
    }
    if (inf.name) {
      return res.status(400).json({ message: 'Already registered' });
    }

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

    if (!Array.isArray(categories) || categories.length < 1 || categories.length > 3) {
      return res.status(400).json({
        message: 'You must select between 1 and 3 categories'
      });
    }
    const interestDocs = await Interest.find({ _id: { $in: categories } });
    if (interestDocs.length !== categories.length) {
      return res.status(400).json({ message: 'Invalid category IDs' });
    }

    const [ageRangeDoc, countRangeDoc, countryDoc, callingDoc] = await Promise.all([
      Audience.findOne({ audienceId: audienceAgeRangeId }),
      AudienceRange.findById(audienceId),
      Country.findById(countryId),
      Country.findById(callingId)
    ]);
    if (!ageRangeDoc || !countRangeDoc || !countryDoc || !callingDoc) {
      return res.status(400).json({ message: 'Invalid reference IDs' });
    }

    inf.name = name;
    inf.password = password;
    inf.phone = phone;
    inf.socialMedia = socialMedia;
    inf.gender = Number(gender);

    inf.platformId = platformDoc._id;
    inf.platformName = platformDoc.name;

    inf.profileLink = profileLink;
    inf.profileImage = `/uploads/profile_images/${req.file.filename}`;

    inf.audienceBifurcation = {
      malePercentage: Number(malePercentage),
      femalePercentage: Number(femalePercentage)
    };

    inf.categories = interestDocs.map(d => d._id);
    inf.categoryName = interestDocs.map(d => d.name);

    inf.audienceAgeRangeId = ageRangeDoc._id;
    inf.audienceAgeRange = ageRangeDoc.range;

    inf.audienceId = countRangeDoc._id;
    inf.audienceRange = countRangeDoc.range;

    inf.countryId = countryId;
    inf.county = countryDoc.countryName;
    inf.callingId = callingId;
    inf.callingcode = callingDoc.callingCode;

    inf.bio = bio;

    const freePlan = await subscriptionHelper.getFreePlan('Influencer');
    if (freePlan) {
      inf.subscription = {
        planId: freePlan.planId,
        planName: freePlan.name,
        startedAt: new Date(),
        expiresAt: subscriptionHelper.computeExpiry(freePlan),
        features: freePlan.features.map(f => ({
          key: f.key,
          limit: typeof f.value === 'number' ? f.value : 0,
          used: 0
        }))
      };
      inf.subscriptionExpired = false;
    }

    await inf.save();
    return res.status(201).json({
      message: 'Influencer registered successfully',
      influencerId: inf.influencerId,
      subscription: inf.subscription
    });
  } catch (err) {
    console.error('Error in registerInfluencer:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Both fields are required' });
  }

  try {
    const influencer = await Influencer.findOne({
      email: { $regex: `^${email.trim()}$`, $options: 'i' }
    });
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
      sortOrder = 'desc'
    } = req.body;

    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required' });
    }

    const filter = { influencerId };
    if (search.trim()) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const total = await Campaign.countDocuments(filter);

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

  const influencer = await Influencer.findOne({
    email: { $regex: `^${email.trim()}$`, $options: 'i' },
    name: { $exists: true, $ne: null },
    password: { $exists: true, $ne: null }
  });

  if (!influencer) {
    return res.status(200).json({ message: 'Email not exist' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

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

  return res.status(200).json({ message: 'OTP has been sent.' });
};

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
  influencer.passwordResetCode = undefined;
  influencer.passwordResetExpiresAt = undefined;
  await influencer.save();

  const resetToken = jwt.sign(
    { influencerId: influencer.influencerId, email: influencer.email, prt: true },
    JWT_SECRET,
    { expiresIn: '15m' }
  );

  return res.status(200).json({ message: 'OTP verified', resetToken });
};

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

    if (!influencer.passwordResetVerified) {
      return res.status(400).json({ message: 'Password reset not verified' });
    }

    influencer.password = newPassword;
    influencer.passwordResetVerified = false;
    await influencer.save();

    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Error in resetPasswordInfluencer:', err);
    return res.status(403).json({ message: 'Invalid or expired reset token' });
  }
};




exports.addPaymentMethod = async (req, res) => {
  try {
    const { influencerId } = req.influencer || {};
    const { type, bank = {}, paypal = {}, isDefault = false } = req.body;

    // validate type
    if (![0, 1].includes(Number(type))) {
      return res.status(400).json({ message: 'type must be 0 (PayPal) or 1 (Bank)' });
    }

    const inf = await Influencer.findOne({ influencerId });
    if (!inf) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const paymentObj = {
      paymentId: uuidv4(),
      type: Number(type),
      bank: undefined,
      paypal: undefined,
      isDefault: Boolean(isDefault)
    };

    if (Number(type) === 1) {
      // 2) require new bank.countryId
      const required = ['accountHolder', 'accountNumber', 'bankName', 'countryId'];
      for (const f of required) {
        if (!bank[f] || !bank[f].toString().trim()) {
          return res.status(400).json({ message: `Missing bank field: ${f}` });
        }
      }

      // 3) fetch country to get its name
      const countryDoc = await Country.findById(bank.countryId);
      if (!countryDoc) {
        return res.status(400).json({ message: 'Invalid bank.countryId' });
      }

      paymentObj.bank = {
        accountHolder: bank.accountHolder.trim(),
        accountNumber: bank.accountNumber.trim(),
        ifsc: bank.ifsc?.trim(),
        swift: bank.swift?.trim(),
        bankName: bank.bankName.trim(),
        branch: bank.branch?.trim(),
        countryId: countryDoc._id,              // store the ObjectId
        countryName: countryDoc.name            // store the fetched name
      };

    } else {
      // PayPal
      if (!paypal.email || !paypal.email.trim()) {
        return res.status(400).json({ message: 'paypal.email is required' });
      }
      paymentObj.paypal = {
        email: paypal.email.trim(),
        username: paypal.username?.trim()
      };
    }

    // ensure only one default
    if (paymentObj.isDefault) {
      inf.paymentMethods.forEach(pm => (pm.isDefault = false));
    } else if (inf.paymentMethods.length === 0) {
      // first method becomes default
      paymentObj.isDefault = true;
    }

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
    const requester = req.influencer;
    const { influencerId, type } = req.body || {};

    // validate inputs
    if (!influencerId) {
      return res.status(400).json({ message: 'influencerId is required' });
    }
    if (type === undefined || ![0, 1].includes(Number(type))) {
      return res.status(400).json({ message: 'type must be 0 (PayPal) or 1 (Bank)' });
    }
    if (!requester || requester.influencerId !== influencerId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const inf = await Influencer.findOne(
      { influencerId },
      'paymentMethods influencerId'
    );
    if (!inf) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    let methods = inf.paymentMethods.filter(pm => pm.type === Number(type));

    if (Number(type) === 1) {
      // mask account numbers
      methods = methods.map(pm => {
        const obj = pm.toObject();
        if (obj.bank?.accountNumber) {
          obj.bank.accountNumber = mask(obj.bank.accountNumber);
        }
        // countryName is safe to return
        return obj;
      });
    }

    return res.status(200).json({
      influencerId: inf.influencerId,
      type: Number(type),
      paymentMethods: methods
    });

  } catch (err) {
    console.error('Error in viewPaymentByType:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};





exports.updatePaymentMethod = async (req, res) => {
  try {
    const { influencerId } = req.influencer || {};
    const {
      paymentId,
      type,
      bank = {},
      paypal = {},
      isDefault
    } = req.body || {};

    // validate
    if (!paymentId) {
      return res.status(400).json({ message: 'paymentId is required' });
    }
    if (type === undefined || ![0, 1].includes(Number(type))) {
      return res.status(400).json({ message: 'type must be 0 (PayPal) or 1 (Bank)' });
    }

    const inf = await Influencer.findOne({ influencerId });
    if (!inf) {
      return res.status(404).json({ message: 'Influencer not found' });
    }

    const pm = inf.paymentMethods.id(paymentId) || inf.paymentMethods.find(p => p.paymentId === paymentId);
    if (!pm) {
      return res.status(404).json({ message: 'Payment method not found' });
    }

    // set new type
    pm.type = Number(type);

    if (pm.type === 1) {
      // bank update: require core fields + countryId
      const required = ['accountHolder', 'accountNumber', 'bankName', 'countryId'];
      for (const f of required) {
        const val = bank[f] ?? pm.bank?.[f];
        if (!val || !String(val).trim()) {
          return res.status(400).json({ message: `Missing bank field: ${f}` });
        }
      }

      // fetch country if changed or use existing
      let countryDoc;
      if (bank.countryId && bank.countryId !== String(pm.bank?.countryId)) {
        countryDoc = await Country.findById(bank.countryId);
        if (!countryDoc) {
          return res.status(400).json({ message: 'Invalid bank.countryId' });
        }
      } else {
        countryDoc = await Country.findById(pm.bank.countryId);
      }

      pm.bank = {
        accountHolder: (bank.accountHolder ?? pm.bank.accountHolder).trim(),
        accountNumber: (bank.accountNumber ?? pm.bank.accountNumber).trim(),
        ifsc: bank.ifsc?.trim() ?? pm.bank.ifsc,
        swift: bank.swift?.trim() ?? pm.bank.swift,
        bankName: (bank.bankName ?? pm.bank.bankName).trim(),
        branch: bank.branch?.trim() ?? pm.bank.branch,
        countryId: countryDoc._id,
        countryName: countryDoc.name
      };
      // clear PayPal
      pm.paypal = undefined;

    } else {
      // PayPal update
      const emailVal = paypal.email ?? pm.paypal?.email;
      if (!emailVal || !String(emailVal).trim()) {
        return res.status(400).json({ message: 'paypal.email is required' });
      }
      pm.paypal = {
        email: paypal.email?.trim() ?? pm.paypal.email,
        username: paypal.username?.trim() ?? pm.paypal.username
      };
      pm.bank = undefined;
    }

    // handle default flag
    if (typeof isDefault === 'boolean') {
      if (isDefault) {
        inf.paymentMethods.forEach(x => (x.isDefault = false));
        pm.isDefault = true;
      } else {
        pm.isDefault = false;
        // ensure at least one default
        if (!inf.paymentMethods.some(x => x.isDefault)) {
          pm.isDefault = true;
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






const delay = ms => new Promise(res => setTimeout(res, ms));

exports.searchInfluencers = async (req, res) => {
  try {
    const requester = req.brand;
    const { search, brandId } = req.body || {};

    if (!brandId) {
      return res.status(400).json({ message: 'brandId is required' });
    }
    if (!requester || requester.brandId !== brandId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!search || !String(search).trim()) {
      return res.status(400).json({ message: 'search is required' });
    }

    await delay(300);

    const regex = new RegExp(search.trim(), 'i');
    const docs = await Influencer
      .find({ name: regex }, 'name influencerId')
      .limit(10)
      .lean();

    if (docs.length === 0) {
      return res.status(404).json({ message: 'No influencers found' });
    }

    const results = docs.map(d => ({
      name: d.name,
      influencerId: d.influencerId
    }));
    return res.json({ results });
  } catch (err) {
    console.error('Error in searchInfluencers:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};





exports.searchBrands = async (req, res) => {
  try {
    const requester = req.influencer;
    const { search } = req.body || {};

    if (!requester || !requester.influencerId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!search || !String(search).trim()) {
      return res.status(400).json({ message: 'search is required' });
    }

    await delay(300);

    const regex = new RegExp(search.trim(), 'i');
    const docs = await Brand.find({ name: regex }, 'name brandId')
      .limit(10)
      .lean();

    if (docs.length === 0) {
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