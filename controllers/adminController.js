// controllers/adminController.js
const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');

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
