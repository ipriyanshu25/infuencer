// app.js
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const mongoose  = require('mongoose');
const http      = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Routes
const influencerRoutes    = require('./routes/influencerRoutes');
const countryRoutes       = require('./routes/countryRoutes');
const brandRoutes         = require('./routes/brandRoutes');
const campaignRoutes      = require('./routes/campaignRoutes');
const interestRoutes      = require('./routes/interestRoutes');
const audienceRoutes      = require('./routes/audienceRoutes');
const applyCampaingRoutes = require('./routes/applyCampaingRoutes');
const contractRoutes      = require('./routes/contractRoutes');
const milestoneRoutes     = require('./routes/milestoneRoutes');
const subscriptionRoutes  = require('./routes/subscriptionRoutes');
const paymentRoutes       = require('./routes/paymentRoutes');
const chatRoutes          = require('./routes/chatRoutes');
const adminRoutes         = require('./routes/adminRoutes');
const policyRoutes        = require('./routes/policyRoutes');
const contactRoutes       = require('./routes/contactRoutes');
const faqsRoutes          = require('./routes/faqsRoutes');
const dashboardRoutes     = require('./routes/dashboardRoutes');
const platformRoutes      = require('./routes/platformRoutes');
const audienceRangeRoutes = require('./routes/audiencerangeRoutes');
const invitationRoutes    = require('./routes/invitationRoutes');

// Models needed inside WS handlers
const ChatRoom = require('./models/chat');

const app    = express();
const server = http.createServer(app);

/* -------------------------------------------------
   WebSocket (ws) setup
------------------------------------------------- */
const wss   = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map(); // roomId -> Set<ws>

function broadcastToRoom(roomId, payloadString) {
  const clients = rooms.get(roomId);
  if (!clients) return;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payloadString);
    }
  }
}

// Optional heartbeat to terminate dead connections
function noop() {}
function heartbeat() { this.isAlive = true; }

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  let joinedRoom = null;

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('Invalid WS JSON:', raw);
      return;
    }

    switch (data.type) {
      case 'joinChat': {
        const { roomId } = data;
        if (!roomId) return;

        joinedRoom = roomId;
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        rooms.get(roomId).add(ws);
        // (optional) send ack
        ws.send(JSON.stringify({ type: 'joined', roomId }));
        break;
      }

      case 'sendChatMessage': {
        const { roomId, senderId, text, replyTo } = data;
        if (!roomId || !senderId || !text) return;

        const room = await ChatRoom.findOne({ roomId });
        if (!room) {
          console.warn(`WS: room ${roomId} not found`);
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

        const payload = JSON.stringify({
          type: 'chatMessage',
          roomId,
          message: msg
        });
        broadcastToRoom(roomId, payload);
        break;
      }

      case 'typing': {
        // optional typing indicator
        const { roomId, senderId, isTyping } = data;
        if (!roomId || !senderId) return;
        const payload = JSON.stringify({
          type: 'typing',
          roomId,
          senderId,
          isTyping: !!isTyping
        });
        broadcastToRoom(roomId, payload);
        break;
      }

      default:
        console.warn('WS: unknown type', data.type);
    }
  });

  ws.on('close', () => {
    if (joinedRoom && rooms.has(joinedRoom)) {
      rooms.get(joinedRoom).delete(ws);
      if (rooms.get(joinedRoom).size === 0) rooms.delete(joinedRoom);
    }
  });
});

// ping clients every 30s
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

/* Expose helpers to controllers */
app.set('wss', wss);
app.set('wsRooms', rooms);
app.set('broadcastToRoom', broadcastToRoom);

/* -------------------------------------------------
   Express middleware
------------------------------------------------- */
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------------------------------------
   REST routes
------------------------------------------------- */
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
app.use('/admin', adminRoutes);
app.use('/policy', policyRoutes);
app.use('/contact', contactRoutes);
app.use('/faqs', faqsRoutes);
app.use('/dash', dashboardRoutes);
app.use('/platform', platformRoutes);
app.use('/audienceRange', audienceRangeRoutes);
app.use('/invitation', invitationRoutes);

/* -------------------------------------------------
   Mongo & start
------------------------------------------------- */
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI)
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