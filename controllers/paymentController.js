require('dotenv').config();
const Razorpay = require('razorpay');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Payment = require('../models/payment');
const Brand = require('../models/brand');  // Assuming Brand model exists
const Influencer = require('../models/influencer');  // Assuming Influencer model exists

// initialize Razorpay client
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a new Razorpay order and persist it based on userId (either brandId or influencerId)
 */
exports.createOrder = async (req, res) => {
  try {
    const { amount, currency = 'USD', receipt, userId, role, planId } = req.body;

    // Check if required fields are present
    if (!userId || !role || !planId || !amount ) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Fetch brand or influencer based on userId and role
    let user;
    if (role === 'Brand') {
      // Query by the `brandId` (which is a string UUID)
      user = await Brand.findOne({ brandId: userId });
    } else if (role === 'Influencer') {
      user = await Influencer.findOne({ influencerId: userId });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // amount in cents for USD
    const options = {
      amount: Math.round(amount * 100),
      currency,
      receipt: receipt || crypto.randomBytes(10).toString('hex'),
    };

    // create order in Razorpay
    const order = await razorpay.orders.create(options);

    // save to DB with user (brand or influencer), plan and role reference
    await Payment.create({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      userId, // Store the UUID userId
      planId,
      role,
      status: 'created',
      createdAt: new Date()
    });

    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


/**
 * Verify payment signature, update status, and auto-assign plan based on userId (brandId or influencerId)
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // validate signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                       .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                       .digest('hex');

    if (hmac !== razorpay_signature) {
      await Payment.findOneAndUpdate({ orderId: razorpay_order_id }, { status: 'failed' });
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // confirm capture
    const razorPayment = await razorpay.payments.fetch(razorpay_payment_id);
    if (razorPayment.status !== 'captured') {
      await Payment.findOneAndUpdate({ orderId: razorpay_order_id }, { status: razorPayment.status });
      return res.status(400).json({ success: false, message: `Payment status: ${razorPayment.status}` });
    }

    // update record as paid
    const paymentRecord = await Payment.findOneAndUpdate(
      { orderId: razorpay_order_id },
      {
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status:    'paid',
        paidAt:    new Date()
      },
      { new: true }
    );

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    console.error('Error in verifyPayment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
