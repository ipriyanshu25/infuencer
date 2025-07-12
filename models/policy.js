// models/Policy.js

const mongoose = require("mongoose");
const { Schema } = mongoose;
const { v4: uuidv4 } = require("uuid");

const SectionSchema = new Schema({
  id: {
    type: String,
    default: uuidv4,      // auto-generate a unique UUID v4
    required: true
  },
  title:   { type: String, required: true },
  content: { type: String, required: true }  // plain text only
}, { _id: false });

const PolicySchema = new Schema({
  policyName:    { type: String, required: true, unique: true },
  effectiveDate: { type: Date,   required: true },
  updatedAt:     { type: Date,   required: true, default: Date.now },
  sections:      { type: [SectionSchema], default: [] }
});

// refresh `updatedAt` on each save
PolicySchema.pre("save", function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Policy", PolicySchema);
