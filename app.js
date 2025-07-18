// app.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// your existing routes
const influencerRoutes = require('./routes/influencerRoutes');
const countryRoutes = require('./routes/countryRoutes');
const brandRoutes = require('./routes/brandRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const interestRoutes = require('./routes/interestRoutes');
const audienceRoutes = require('./routes/audienceRoutes');
const applyCampaingRoutes = require('./routes/applyCampaingRoutes');
const contractRoutes = require('./routes/contractRoutes');
const milestoneRoutes = require('./routes/milestoneRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const chatRoutes = require('./routes/chatRoutes');
const adminRoutes = require('./routes/adminRoutes'); // Assuming you have this route
const policy = require('./routes/policyRoutes');
const contact = require('./routes/contactRoutes');
const faqs = require('./routes/faqsRoutes');
const dashboard = require('./routes/dashboardRoutes');

const app = express();
const server = http.createServer(app);

// --- WebSocket setup using 'ws' ---
const wss = new WebSocket.Server({ server, path: '/ws' });

// Map of roomId -> Set of WebSocket clients
const rooms = new Map();

wss.on('connection', (ws, req) => {
  // track which room this socket has joined
  let joinedRoom = null;

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      console.error('Invalid JSON:', message);
      return;
    }

    switch (data.type) {
      case 'joinChat':
        {
          const { roomId } = data;
          joinedRoom = roomId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId).add(ws);
          console.log(`Client joined room ${roomId}`);
        }
        break;

      case 'sendChatMessage':
        {
          const { roomId, senderId, text, replyTo } = data;
          // Save to Mongo
          const ChatRoom = require('./models/chat');
          const room = await ChatRoom.findOne({ roomId });
          if (!room) {
            console.warn(`Room ${roomId} not found`);
            return;
          }

          const msg = {
            messageId: uuidv4(),
            senderId,
            text,
            timestamp: new Date(),
            replyTo: replyTo || null
          };
          room.messages.push(msg);
          await room.save();

          // Broadcast to everyone in the room
          const payload = JSON.stringify({
            type: 'chatMessage',
            roomId,
            message: msg
          });

          const clients = rooms.get(roomId) || new Set();
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(payload);
            }
          }
        }
        break;

      default:
        console.warn('Unknown message type:', data.type);
    }
  });

  ws.on('close', () => {
    // Remove from room when connection closes
    if (joinedRoom && rooms.has(joinedRoom)) {
      rooms.get(joinedRoom).delete(ws);
      if (rooms.get(joinedRoom).size === 0) {
        rooms.delete(joinedRoom);
      }
    }
  });
});
// --- end WebSocket setup ---

// CORS + body parsers
app.use(cors({
  // origin: process.env.FRONTEND_ORIGIN || 'https://collabglam.com',
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',

  credentials: true     
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// REST routes
app.use('/influencer', influencerRoutes);
app.use('/country', countryRoutes);
app.use('/brand', brandRoutes);
app.use('/campaign', campaignRoutes);
app.use('/interest', interestRoutes);
app.use('/audience', audienceRoutes);
app.use('/apply', applyCampaingRoutes);
app.use('/contract', contractRoutes);
app.use('/milestone', milestoneRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/chat', chatRoutes);
app.use('/payment', paymentRoutes);
// Admin routes
app.use('/admin', adminRoutes);
app.use('/policy',policy);
app.use('/contact',contact);
app.use('/faqs',faqs);
app.use('/dash',dashboard);

// connect to Mongo & start server
const PORT = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    server.listen(PORT, () => {
      console.log(`🚀 Server listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
