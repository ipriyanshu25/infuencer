// controllers/chatController.js
const { v4: uuidv4 } = require('uuid');
const ChatRoom    = require('../models/chat');
const Brand       = require('../models/brand');
const Influencer  = require('../models/influencer');

// 1) Create (or return) a one-to-one room
exports.createRoom = async (req, res) => {
  const { brandId, influencerId } = req.body;
  if (!brandId || !influencerId) {
    return res.status(400).json({ message: 'brandId and influencerId are required' });
  }

  const [ brand, infl ] = await Promise.all([
    Brand.findOne({ brandId }, 'name'),
    Influencer.findOne({ influencerId }, 'name')
  ]);
  if (!brand || !infl) {
    return res.status(404).json({ message: 'Brand or Influencer not found' });
  }

  const participants = [
    { userId: brandId,      name: brand.name },
    { userId: influencerId, name: infl.name }
  ].sort((a, b) => a.userId.localeCompare(b.userId));

  // 🔑 match both userIds in one go
  let room = await ChatRoom.findOne({
    'participants.userId': { $all: [ brandId, influencerId ] }
  });

  let message;
  if (!room) {
    room = new ChatRoom({ participants });
    await room.save();
    message = 'Chat room created';
  } else {
    message = 'Chat room already exists';
  }

  return res.json({ message, roomId: room.roomId });
};

// 2) List all rooms for a user
exports.getRooms = async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }
  const rooms = await ChatRoom.find({ 'participants.userId': userId }).lean();
  const summary = rooms.map(room => {
    const last = room.messages[room.messages.length - 1] || null;
    return {
      roomId:       room.roomId,
      participants: room.participants,
      lastMessage:  last
    };
  });
  return res.json({ message: 'Rooms retrieved', rooms: summary });
};

// 3) Fetch last N messages for a room
exports.getMessages = async (req, res) => {
  const { roomId, limit = 50 } = req.body;
  if (!roomId) {
    return res.status(400).json({ message: 'roomId is required' });
  }
  const room = await ChatRoom.findOne({ roomId });
  if (!room) {
    return res.status(404).json({ message: 'Chat room not found' });
  }
  const msgs = room.messages.slice(-limit);
  return res.json({ message: 'Messages fetched', messages: msgs });
};

// 4) Send a new message (REST fallback) — now with optional replyTo
exports.postMessage = async (req, res) => {
  const { roomId, senderId, text, replyTo } = req.body;
  if (!roomId || !senderId || !text) {
    return res.status(400).json({ message: 'roomId, senderId and text are required' });
  }

  const room = await ChatRoom.findOne({ roomId });
  if (!room) {
    return res.status(404).json({ message: 'Chat room not found' });
  }

  // Build the new message
  const msg = {
    messageId: uuidv4(),
    senderId,
    text,
    timestamp: new Date(),
    replyTo: replyTo || null
  };
  room.messages.push(msg);
  await room.save();

  // Broadcast over socket
  const io = req.app.get('io');
  io.to(`chat_${roomId}`).emit('chatMessage', { roomId, message: msg });

  return res.status(201).json({
    message:     'Message sent',
    messageData: msg
  });
};
