// models/chat.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const messageSchema = new mongoose.Schema({
  messageId:  { type: String, required: true, unique: true, default: uuidv4 },
  senderId:   { type: String, required: true },    // brandId or influencerId
  text:       { type: String, required: true },
  timestamp:  { type: Date,   default: Date.now },
  replyTo:    { type: String, default: null }      // messageId of the message this one replies to
});

const participantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name:   { type: String, required: true }
}, { _id: false });

const chatRoomSchema = new mongoose.Schema({
  roomId:       { type: String, required: true, unique: true, default: uuidv4 },
  participants: { type: [participantSchema], required: true },  // [{ userId, name }, …]
  messages:     { type: [messageSchema],    default: [] }
}, { timestamps: true });

module.exports = mongoose.model('ChatRoom', chatRoomSchema);
