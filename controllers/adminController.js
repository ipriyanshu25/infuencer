// controllers/adminController.js
const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');
const Brand = require('../models/brand'); // Assuming you have a Brand model

/**
 * POST /admin/login
 * body: { email, password }
 */
exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email & password are required' });

  const admin = await Admin.findOne({ email: email.toLowerCase() });
  if (!admin || !(await admin.correctPassword(password))) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { adminId: admin.adminId, email: admin.email },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    message: 'Login successful',
    token,
    admin: { adminId: admin.adminId, email: admin.email }
  });
};


exports.getAllBrands = async (req, res) => {
  try {
    // 1) Pull pagination, search & sort params from the body
    const page      = Math.max(parseInt(req.body.page, 10)  || 1,  1);
    const limit     = Math.min(Math.max(parseInt(req.body.limit, 10) || 10, 1), 100);
    const search    = (req.body.search || '').trim();
    const sortBy    = req.body.sortBy    || 'name';
    const sortOrder = (req.body.sortOrder || 'asc').toLowerCase();

    // 2) Build filter
    const filter = {};
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ name: re }, { email: re }];
    }

    // 3) Count total for meta
    const total = await Brand.countDocuments(filter);

    // 4) Validate sort inputs & build sort object
    const ALLOWED_SORT_FIELDS = ['name', 'email', 'createdAt'];
    const sortField = ALLOWED_SORT_FIELDS.includes(sortBy) ? sortBy : 'name';
    const direction = sortOrder === 'desc' ? -1 : 1;
    const sortObj = { [sortField]: direction };

    // 5) Fetch the page with dynamic sort
    const brands = await Brand.find(filter)
      .select('-password -_id -__v')
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // 6) Return structured response
    return res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      brands
    });
  } catch (error) {
    console.error('Error in getAllBrands:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


// controllers/influencerController.js
exports.getList = async (req, res) => {
  try {
    // 1) Pull pagination, search & sort params from the body
    const page      = Math.max(parseInt(req.body.page, 10)  || 1,  1);
    const limit     = Math.min(Math.max(parseInt(req.body.limit, 10) || 10, 1), 100);
    const search    = (req.body.search || '').trim();
    const sortBy    = req.body.sortBy    || 'name';
    const sortOrder = (req.body.sortOrder || 'asc').toLowerCase();

    // 2) Build filter (searching name or email)
    const filter = {};
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ name: re }, { email: re }];
    }

    // 3) Get total count for pagination meta
    const total = await Influencer.countDocuments(filter);

    // 4) Validate sort inputs & build sort object
    const ALLOWED_SORT = ['name', 'email', 'createdAt'];
    const field  = ALLOWED_SORT.includes(sortBy) ? sortBy : 'name';
    const dir    = sortOrder === 'desc' ? -1 : 1;
    const sortObj = { [field]: dir };

    // 5) Fetch the page
    const influencers = await Influencer.find(filter)
      .select('-password -__v')
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // 6) Return structured response
    return res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      influencers
    });
  } catch (error) {
    console.error('Error fetching influencers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
