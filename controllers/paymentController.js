// controllers/paymentController.js
require('dotenv').config();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Payment = require('../models/payment');

// initialize Razorpay client
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a new Razorpay order and persist it
 */
exports.createOrder = async (req, res) => {
  try {
    const { amount, currency = 'USD', receipt, brandId, planId } = req.body;
    if (!brandId || !planId) {
      return res.status(400).json({ success: false, message: 'brandId and planId are required' });
    }
    // amount in cents for USD
    const options = {
      amount: Math.round(amount * 100),
      currency,
      receipt: receipt || crypto.randomBytes(10).toString('hex'),
    };

    // create order in Razorpay
    const order = await razorpay.orders.create(options);

    // save to DB with brand and plan reference
    await Payment.create({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      receipt:  order.receipt,
      brandId,
      planId,
      status:   'created',
      createdAt: new Date()
    });

    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error('Error in createOrder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Verify payment signature and update status
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // validate signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                       .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                       .digest('hex');

    if (hmac !== razorpay_signature) {
      // mark failed
      await Payment.findOneAndUpdate({ orderId: razorpay_order_id }, { status: 'failed' });
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // fetch payment details to ensure captured
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.status !== 'captured') {
      await Payment.findOneAndUpdate({ orderId: razorpay_order_id }, { status: payment.status });
      return res.status(400).json({ success: false, message: `Payment status: ${payment.status}` });
    }

    // update record as paid
    await Payment.findOneAndUpdate(
      { orderId: razorpay_order_id },
      {
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        status:    'paid',
        paidAt:    new Date()
      }
    );

    res.json({ success: true, message: 'Payment verified and captured' });
  } catch (error) {
    console.error('Error in verifyPayment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
