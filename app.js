// app.js
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const influencerRoutes    = require('./routes/influencerRoutes');
const countryRoutes        = require('./routes/countryRoutes');
const brandRoutes = require('./routes/brandRoutes'); // Assuming you have this route
const campaignRoutes = require('./routes/campaignRoutes'); // Assuming you have this route
const interestRoutes = require('./routes/interestRoutes'); // Assuming you have this route
const audienceRoutes = require('./routes/audienceRoutes'); // Assuming you have this route


const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin:      process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/influencer', influencerRoutes);
app.use('/country', countryRoutes);
app.use('/brand', brandRoutes);
app.use('/campaign', campaignRoutes); // Assuming you have this route
app.use('/interest', interestRoutes); // Assuming you have this route
app.use('/audience', audienceRoutes); // Assuming you have this route


// ─── DB + SERVER START ───────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)  // no need for useNewUrlParser/useUnifiedTopology
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
