// controllers/chatController.js
const { v4: uuidv4 } = require('uuid');
const ChatRoom       = require('../models/chat');
const Brand          = require('../models/brand');
const Influencer     = require('../models/influencer');

/* -----------------------------------------------------------
   Helpers
----------------------------------------------------------- */
function sortParticipants(a, b) {
  return a.userId.localeCompare(b.userId);
}

function broadcast(app, roomId, payloadObj) {
  const broadcastToRoom = app.get('broadcastToRoom'); // set in app.js
  if (typeof broadcastToRoom === 'function') {
    broadcastToRoom(roomId, JSON.stringify(payloadObj));
  }
}

/* -----------------------------------------------------------
   1) Create (or return) a one‑to‑one room
   POST /chat/create-room
   body: { brandId, influencerId }
----------------------------------------------------------- */
exports.createRoom = async (req, res) => {
  try {
    const { brandId, influencerId } = req.body;
    if (!brandId || !influencerId) {
      return res.status(400).json({ message: 'brandId and influencerId are required' });
    }

    const [brand, infl] = await Promise.all([
      Brand.findOne({ brandId }, 'name'),
      Influencer.findOne({ influencerId }, 'name')
    ]);
    if (!brand || !infl) {
      return res.status(404).json({ message: 'Brand or Influencer not found' });
    }

    const participants = [
      { userId: brandId,      name: brand.name, role: 'brand' },
      { userId: influencerId, name: infl.name,  role: 'influencer' }
    ].sort(sortParticipants);

    // find if both ids already present
    let room = await ChatRoom.findOne({
      'participants.userId': { $all: [brandId, influencerId] },
      'participants.2': { $exists: false } // ensure it's a 1-1 room
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
  } catch (err) {
    console.error('createRoom error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/* -----------------------------------------------------------
   2) List all rooms for a user
   POST /chat/rooms
   body: { userId }
----------------------------------------------------------- */
exports.getRooms = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const rooms = await ChatRoom.find({ 'participants.userId': userId })
      .select('roomId participants messages.createdAt messages.text messages.senderId messages.timestamp')
      .lean();

    const summary = rooms.map(room => {
      const last = room.messages[room.messages.length - 1] || null;
      return {
        roomId:       room.roomId,
        participants: room.participants,
        lastMessage:  last
      };
    });

    return res.json({ message: 'Rooms retrieved', rooms: summary });
  } catch (err) {
    console.error('getRooms error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/* -----------------------------------------------------------
   3) Fetch last N messages for a room (with optional pagination)
   POST /chat/messages
   body: { roomId, limit = 50, before? }  // 'before' is ISO date/string to paginate older msgs
----------------------------------------------------------- */
exports.getMessages = async (req, res) => {
  try {
    const { roomId, limit = 50, before } = req.body;
    if (!roomId) return res.status(400).json({ message: 'roomId is required' });

    const room = await ChatRoom.findOne({ roomId });
    if (!room) return res.status(404).json({ message: 'Chat room not found' });

    let msgs = room.messages;
    if (before) {
      const cut = new Date(before);
      msgs = msgs.filter(m => m.timestamp < cut);
    }
    msgs = msgs.slice(-Math.max(1, parseInt(limit, 10)));

    return res.json({ message: 'Messages fetched', messages: msgs });
  } catch (err) {
    console.error('getMessages error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/* -----------------------------------------------------------
   4) Send a new message (REST fallback) — supports replyTo
   POST /chat/send
   body: { roomId, senderId, text, replyTo? }
----------------------------------------------------------- */
exports.postMessage = async (req, res) => {
  try {
    const { roomId, senderId, text, replyTo } = req.body;
    if (!roomId || !senderId || !text) {
      return res.status(400).json({ message: 'roomId, senderId and text are required' });
    }

    const room = await ChatRoom.findOne({ roomId });
    if (!room) return res.status(404).json({ message: 'Chat room not found' });

    const msg = {
      messageId: uuidv4(),
      senderId,
      text,
      timestamp: new Date(),
      replyTo: replyTo || null
    };

    room.messages.push(msg);
    await room.save();

    // Broadcast over WebSocket (ws)
    broadcast(req.app, roomId, {
      type: 'chatMessage',
      roomId,
      message: msg
    });

    return res.status(201).json({ message: 'Message sent', messageData: msg });
  } catch (err) {
    console.error('postMessage error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/* -----------------------------------------------------------
   5) Edit a message (optional)
   PATCH /chat/edit
   body: { roomId, messageId, senderId, newText }
----------------------------------------------------------- */
exports.editMessage = async (req, res) => {
  try {
    const { roomId, messageId, senderId, newText } = req.body;
    if (!roomId || !messageId || !senderId || !newText) {
      return res.status(400).json({ message: 'roomId, messageId, senderId, newText required' });
    }

    const room = await ChatRoom.findOne({ roomId });
    if (!room) return res.status(404).json({ message: 'Chat room not found' });

    const msg = room.messages.find(m => m.messageId === messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    if (msg.senderId !== senderId) {
      return res.status(403).json({ message: 'You can edit only your own messages' });
    }

    msg.text = newText;
    msg.editedAt = new Date();
    await room.save();

    broadcast(req.app, roomId, {
      type: 'chatMessageEdited',
      roomId,
      message: msg
    });

    return res.json({ message: 'Message edited', message: msg });
  } catch (err) {
    console.error('editMessage error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/* -----------------------------------------------------------
   6) Delete a message (optional hard delete)
   DELETE /chat/message
   body: { roomId, messageId, senderId }
----------------------------------------------------------- */
exports.deleteMessage = async (req, res) => {
  try {
    const { roomId, messageId, senderId } = req.body;
    if (!roomId || !messageId || !senderId) {
      return res.status(400).json({ message: 'roomId, messageId, senderId required' });
    }

    const room = await ChatRoom.findOne({ roomId });
    if (!room) return res.status(404).json({ message: 'Chat room not found' });

    const idx = room.messages.findIndex(m => m.messageId === messageId);
    if (idx === -1) return res.status(404).json({ message: 'Message not found' });

    const msg = room.messages[idx];
    if (msg.senderId !== senderId) {
      return res.status(403).json({ message: 'You can delete only your own messages' });
    }

    room.messages.splice(idx, 1);
    await room.save();

    broadcast(req.app, roomId, {
      type: 'chatMessageDeleted',
      roomId,
      messageId
    });

    return res.json({ message: 'Message deleted', messageId });
  } catch (err) {
    console.error('deleteMessage error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};