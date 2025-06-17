// controllers/chatController.js
const ChatRoom    = require('../models/chat');
const Brand       = require('../models/brand');
const Influencer  = require('../models/influencer');

// 1) Create (or return) a one-to-one room, storing both IDs & names
exports.createRoom = async (req, res) => {
  const { brandId, influencerId } = req.body;
  if (!brandId || !influencerId) {
    return res.status(400).json({ message: 'brandId and influencerId are required' });
  }

  // fetch their names in parallel
  const [ brand, infl ] = await Promise.all([
    Brand.findOne({ brandId }, 'name'),
    Influencer.findOne({ influencerId }, 'name')
  ]);
  if (!brand || !infl) {
    return res.status(404).json({ message: 'Brand or Influencer not found' });
  }

  // sort by ID so order doesn’t matter
  const participants = [
    { userId: brandId,      name: brand.name },
    { userId: influencerId, name: infl.name }
  ].sort((a, b) => a.userId.localeCompare(b.userId));

  // 🔑 find a room that already has *both* userIds
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

  return res.json({
    message,
    roomId: room.roomId
  });
};

// 2) List all rooms for a given user (with last message & names)
exports.getRooms = async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }

  const rooms = await ChatRoom.find({ 'participants.userId': userId }).lean();
  const summary = rooms.map(room => {
    const lastMsg = room.messages.length
      ? room.messages[room.messages.length - 1]
      : null;
    return {
      roomId:       room.roomId,
      participants: room.participants,
      lastMessage:  lastMsg
    };
  });

  return res.json({
    message: 'Rooms retrieved',
    rooms:   summary
  });
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
  return res.json({
    message:  'Messages fetched',
    messages: msgs
  });
};

// 4) Append a new message (REST fallback) and broadcast
exports.postMessage = async (req, res) => {
  const { roomId, senderId, text } = req.body;
  if (!roomId || !senderId || !text) {
    return res.status(400).json({ message: 'roomId, senderId and text are required' });
  }
  const room = await ChatRoom.findOne({ roomId });
  if (!room) {
    return res.status(404).json({ message: 'Chat room not found' });
  }
  const msg = { senderId, text, timestamp: new Date() };
  room.messages.push(msg);
  await room.save();

  const io = req.app.get('io');
  io.to(`chat_${roomId}`).emit('chatMessage', { roomId, message: msg });

  return res.status(201).json({
    message: 'Message sent',
    messageData: msg
  });
};
