// controllers/contactController.js

require('dotenv').config();
const Contact    = require('../models/contactUs');
const nodemailer = require('nodemailer');

exports.sendContact = async (req, res) => {
  try {
    // 1) Validate input
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // 2) Configure transporter
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      logger: true,
      debug:  true,
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
      }
    });

    // 3) Verify connection (optional, but helps fail fast)
    await transporter.verify();

    // 4) Send notification email
    await transporter.sendMail({
      from:    `${name} <${email}>`,
      to:      process.env.MAIL_TO,
      replyTo: email,
      subject: `Contact Us: ${subject}`,
      text:    `Name: ${name}\nEmail: ${email}\n\n${message}`
    });

    // 5) Only now persist to database
    const saved = await new Contact({ name, email, subject, message }).save();

    return res.status(201).json({
      message: 'Message sent and saved successfully',
      contact: saved
    });

  } catch (err) {
    console.error('ContactController Error:', err);
    // if mail failed, we never saved anything
    return res.status(500).json({ error: 'Could not send message, please try again later' });
  }
};


exports.getAllContacts = async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    return res.status(200).json(contacts);
  } catch (err) {
    console.error('getAllContacts error', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
