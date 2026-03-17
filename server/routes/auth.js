const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_123_dsl_engine';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// 1 Week Cookie Expiry: 7 days * 24 hours * 60 mins * 60 secs * 1000 ms
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Helper to generate token and set cookie
const generateTokenAndSetCookie = (res, userId) => {
  const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
  
  const isProd = process.env.NODE_ENV === 'production';
  const secure = process.env.COOKIE_SECURE === 'true' || (isProd && process.env.COOKIE_SECURE !== 'false');
  const sameSite = process.env.COOKIE_SAMESITE || 'lax'; // 'lax', 'strict', or 'none'
  const domain = process.env.COOKIE_DOMAIN; // e.g. '.yourdomain.com'

  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: COOKIE_MAX_AGE
  };

  if (domain) {
    cookieOptions.domain = domain;
  }

  res.cookie('token', token, cookieOptions);
  
  return token;
};

// @route   POST /auth/signup
// @desc    Register user with Email & Password
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please provide all details' });
    }

    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();

    // Generate token & Cookie
    generateTokenAndSetCookie(res, user._id);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// @route   POST /auth/login
// @desc    Login user with Email & Password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(400).json({ error: 'Invalid Credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid Credentials' });
    }

    generateTokenAndSetCookie(res, user._id);

    res.json({
      message: 'Logged in successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// @route   POST /auth/google
// @desc    Google Sign-In via Access Token
router.post('/google', async (req, res) => {
  try {
    const { idToken: accessToken } = req.body; // Named idToken from frontend to maintain payload compatibility

    if (!accessToken) {
      return res.status(400).json({ error: 'No Google Token provided' });
    }

    // Verify token with Google Userinfo API
    const response = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`);
    if (!response.ok) {
      return res.status(401).json({ error: 'Failed to verify Google Token' });
    }

    const payload = await response.json();
    const { sub: googleId, email, name, picture: avatar } = payload;

    if (!email) {
      return res.status(400).json({ error: 'Google did not provide an email' });
    }

    // Check if user already exists
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Update Google ID if not present (incase they registered via email first)
      if (!user.googleId) {
        user.googleId = googleId;
        if (!user.avatar) user.avatar = avatar;
        await user.save();
      }
    } else {
      // Create new Google User
      user = new User({
        name,
        email,
        googleId,
        avatar
      });
      await user.save();
    }

    generateTokenAndSetCookie(res, user._id);

    res.json({
      message: 'Logged in via Google successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    });

  } catch (err) {
    console.error('Google Auth error:', err);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// @route   GET /auth/me
// @desc    Get Current User from Cookie
router.get('/me', async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json(user);

  } catch (err) {
    res.status(401).json({ error: 'Session invalid or expired' });
  }
});

// @route   POST /auth/logout
// @desc    Logout and clear cookie
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
