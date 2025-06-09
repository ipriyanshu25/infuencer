// models/Influencer.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Regular expressions for validating email and phone number formats
const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
const phoneRegex = /^[0-9]{10}$/;

const influencerSchema = new mongoose.Schema({
  influencerId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  name: { 
    type: String,
    required: true
  },
  email: { 
    type: String,
    required: true,
    unique: true,
    match: [emailRegex, 'Please enter a valid email address']
  },
  password: { 
    type: String,
    required: true,
    minlength: 8 
  },
  phone: { 
    type: String,
    required: true,
    match: [phoneRegex, 'Please enter a valid 10-digit phone number']
  },
  socialMedia: { 
    type: String,
    required: true
  },

  // --- CHANGED: category now references Interest ---
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Interest',
    required: true
  },
   categoryName: { 
    type: String,
    required: true 
  },

  // --- NEW: audienceSize with fixed ranges ---
  audienceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AudienceRange',
    required: true
  },
  audienceRange: {
    type: String,
    required: true
  },

  // these stay as before
  callingcode: { 
    type: String,
    required: true 
  },
  county: { 
    type: String,
    required: true 
  },
  countryId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Country',
    required: true
  },
  callingId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Country',
    required: true
  },
  bio: { 
    type: String,
    default: '' 
  },
  createdAt: { 
    type: Date,
    default: Date.now 
  }
});

// Hash password before saving (only if it's new or changed)
influencerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords during login
influencerSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Influencer', influencerSchema);
