const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String }, // Optional for Google users
    googleId: { type: String, unique: true, sparse: true }, // Optional for local users
    avatar: { type: String },
    role: { type: String, default: 'user' }
  },
  { 
    timestamps: true,
    collection: 'user_accounts' // Explicitly set collection name
  }
);

module.exports = mongoose.model('User', UserSchema);
