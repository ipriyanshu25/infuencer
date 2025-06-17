// app.js
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const mongoose = require('mongoose');
const http     = require('http');
const { Server } = require('socket.io');

// your existing routes
const influencerRoutes    = require('./routes/influencerRoutes');
const countryRoutes       = require('./routes/countryRoutes');
const brandRoutes         = require('./routes/brandRoutes');
const campaignRoutes      = require('./routes/campaignRoutes');
const interestRoutes      = require('./routes/interestRoutes');
const audienceRoutes      = require('./routes/audienceRoutes');
const applyCampaingRoutes = require('./routes/applyCampaingRoutes');
const contractRoutes      = require('./routes/contractRoutes');
const milestoneRoutes     = require('./routes/milestoneRoutes');
// new chat routes
const chatRoutes          = require('./routes/chatRoutes');

const app    = express();
const server = http.createServer(app);

// attach Socket.io
const io = new Server(server, {
  cors: {
    origin:      process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    methods:     ['GET','POST'],
    credentials: true
  }
});

// make io available in your controllers
app.set('io', io);

// handle socket connections
io.on('connection', socket => {
  socket.on('joinChat', ({ roomId }) => {
    socket.join(`chat_${roomId}`);
  });

  socket.on('sendChatMessage', async ({ roomId, senderId, text, replyTo }) => {
    const ChatRoom = require('./models/chat');
    const room = await ChatRoom.findOne({ roomId });
    if (!room) return;

    const msg = {
      messageId: uuidv4(),
      senderId,
      text,
      timestamp: new Date(),
      replyTo: replyTo || null
    };
    room.messages.push(msg);
    await room.save();

    io.to(`chat_${roomId}`)
      .emit('chatMessage', { roomId, message: msg });
  });
});

// CORS + body parsers
app.use(cors({
  origin:      process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// REST routes
app.use('/influencer', influencerRoutes);
app.use('/country',    countryRoutes);
app.use('/brand',      brandRoutes);
app.use('/campaign',   campaignRoutes);
app.use('/interest',   interestRoutes);
app.use('/audience',   audienceRoutes);
app.use('/apply',      applyCampaingRoutes);
app.use('/contract',   contractRoutes);
app.use('/milestone',  milestoneRoutes);
app.use('/chat', chatRoutes);

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
