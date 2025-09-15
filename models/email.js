// model/email.js
'use strict';

const mongoose = require('mongoose');

const EMAIL_RX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const HANDLE_RX = /^@[A-Za-z0-9._\-]+$/;

const EmailContactSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    unique: true,
    validate: {
      validator: (v) => EMAIL_RX.test(v || ''),
      message: 'Invalid email address',
    },
  },
  handle: {
    type: String,
    required: [true, 'Handle is required'],
    trim: true,
    lowercase: true,
    unique: true,
    validate: {
      validator: (v) => HANDLE_RX.test(v || ''),
      message: 'Handle must start with "@" and contain letters, numbers, ".", "_" or "-"',
    },
  },
}, { timestamps: true });

module.exports = mongoose.models.EmailContact
  || mongoose.model('EmailContact', EmailContactSchema);
