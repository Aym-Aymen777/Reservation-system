// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './config/.env') });
const Redis = require("ioredis");

const redis = new Redis(process.env.UPSTASH_REDIS_URL);

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : 'http://localhost:3000',
  credentials: true
}));



// Rate limiting - more restrictive for OTP endpoints
 const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, error: 'Too many requests, please try again later' }
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 OTP requests per 15 minutes per IP
  message: { success: false, error: 'Too many OTP requests, please try again later' }
});

app.use('/api/send-otp', otpLimiter);
app.use(generalLimiter);

// MongoDB connection with better error handling
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      connectTimeoutMS: 60000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}
// Enhanced reservation schema
const reservationSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    minlength: 2,
    maxlength: 50,
    trim: true
  },
  phone: { 
    type: String, 
    required: true, 
    match: /^\+[1-9]\d{1,14}$/,
    index: true
  },
  partySize: { 
    type: Number, 
    required: true, 
    min: 1, 
    max: 20 
  },
  reservationTime: { 
    type: Date, 
    required: true,
    validate: {
      validator: function(v) {
        return v > new Date();
      },
      message: 'Reservation time must be in the future'
    }
  },
  verified: { 
    type: Boolean, 
    default: false 
  },
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'cancelled'], 
    default: 'pending' 
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  },
  specialRequests: {
    type: String,
    maxlength: 500,
    trim: true
  }
});

// Add compound index to prevent duplicate reservations
reservationSchema.index({ phone: 1, reservationTime: 1 });

const Reservation = mongoose.model('Reservation', reservationSchema);

// Utility functions
const formatPhoneNumber = (phone) => {
  // Remove any spaces, dashes, or parentheses and ensure it starts with +
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const isBusinessHours = (date) => {
  const hour = date.getHours();
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Restaurant hours: Tuesday-Sunday, 11 AM - 10 PM (closed on Mondays)
  if (day === 1) return false; // Closed on Mondays
  return hour >= 11 && hour <= 22;
};

// Middleware for validation
const validatePhone = (req, res, next) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }
  
  const formattedPhone = formatPhoneNumber(phone);
  if (!/^\+[1-9]\d{1,14}$/.test(formattedPhone)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
  }
  
  req.body.phone = formattedPhone;
  next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });
  
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, error: errors.join(', ') });
  }
  
  if (err.name === 'MongoServerError' && err.code === 11000) {
    return res.status(400).json({ success: false, error: 'Reservation already exists for this time slot' });
  }
  
  res.status(500).json({ success: false, error: 'Internal server error. Please try again.' });
};

// API Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

// Generate and send OTP via WhatsApp
app.post('/api/send-otp', validatePhone, async (req, res, next) => {
  try {
    const { phone } = req.body;
    
    // Check if OTP was recently sent (prevent spam)
    const recentOtp = await redis.get(`otp_sent:${phone}`);
    if (recentOtp) {
      return res.status(429).json({ 
        success: false, 
        error: 'OTP already sent. Please wait 60 seconds before requesting again.' 
      });
    }
    
    const otp = generateOTP();
    
    // Store OTP with 5 minute expiration
    await redis.setex(`otp:${phone}`, 300, otp);
    // Prevent spam - 60 second cooldown
    await redis.setex(`otp_sent:${phone}`, 60, 'true');
    
    // Send WhatsApp message
    const whatsappResponse = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: "code4u", // Make sure this template is approved in your Meta Business account
          language: { code: 'en_US' },
           components: [{
            type: 'body',
            parameters: [{ type: 'text', text: otp }]
          }]
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );
    
    console.log('WhatsApp API response:', whatsappResponse.data);
    res.json({ success: true, message: 'OTP sent successfully' });
    
  } catch (error) {
    console.error('OTP sending error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      return res.status(500).json({ success: false, error: 'WhatsApp service unavailable' });
    }
    
    next(error);
  }
});

// Verify OTP
app.post('/api/verify-otp', validatePhone, async (req, res) => {
  try {
    const { phone, otp } = req.body;
    
    if (!otp || otp.length !== 6) {
      return res.status(400).json({ success: false, error: 'Please enter a valid 6-digit OTP' });
    }
    
    const storedOtp = await redis.get(`otp:${phone}`);
    
    if (!storedOtp) {
      return res.status(400).json({ success: false, error: 'OTP expired or not found. Please request a new one.' });
    }
    
    if (storedOtp !== otp) {
      return res.status(400).json({ success: false, error: 'Invalid OTP. Please try again.' });
    }
    
    // Clean up OTP and mark phone as verified
    await redis.del(`otp:${phone}`);
    await redis.setex(`verified:${phone}`, 600, 'true'); // 10 minute verification window
    
    res.json({ success: true, verified: true, message: 'Phone number verified successfully' });
    
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
  }
});

// Create reservation
app.post('/api/reservations', validatePhone, async (req, res, next) => {
  try {
    const { name, phone, partySize, reservationTime, specialRequests } = req.body;
    
    // Check if phone is verified
    const isVerified = await redis.get(`verified:${phone}`);
    if (!isVerified) {
      return res.status(403).json({ success: false, error: 'Phone number not verified. Please verify first.' });
    }
    
    // Validate reservation time
    const resDate = new Date(reservationTime);
    if (isNaN(resDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid reservation time' });
    }
    
    if (resDate <= new Date()) {
      return res.status(400).json({ success: false, error: 'Reservation time must be in the future' });
    }
    
    if (!isBusinessHours(resDate)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Reservations are only available Tuesday-Sunday, 11 AM - 10 PM' 
      });
    }
    
    // Check for existing reservation (same phone, same day)
    const startOfDay = new Date(resDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(resDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const existingReservation = await Reservation.findOne({
      phone,
      reservationTime: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] }
    });
    
    if (existingReservation) {
      return res.status(400).json({ 
        success: false, 
        error: 'You already have a reservation for this date' 
      });
    }
    
    // Create reservation
    const reservation = new Reservation({
      name: name.trim(),
      phone,
      partySize: parseInt(partySize),
      reservationTime: resDate,
      verified: true,
      status: 'confirmed',
      specialRequests: specialRequests?.trim() || ''
    });
    
    await reservation.save();
    
    // Send confirmation via WhatsApp
    try {
      await axios.post(
        `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: 'delivery_confirmation_2', // Make sure this template is approved
            language: { code: 'en_US' },
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: name },
                { type: 'text', text: resDate.toLocaleString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric', 
                  hour: 'numeric', 
                  minute: '2-digit',
                  hour12: true 
                })}
              ]
            }]
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
    } catch (whatsappError) {
      console.error('WhatsApp confirmation error:', whatsappError.response?.data || whatsappError.message);
      // Don't fail the reservation if WhatsApp fails
    }
    
    // Clean up verification token
    await redis.del(`verified:${phone}`);
    
    res.json({ 
      success: true, 
      message: 'Reservation created successfully', 
      reservation: {
        id: reservation._id,
        name: reservation.name,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime,
        status: reservation.status
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Get reservation by phone (for checking existing reservations)
app.get('/api/reservations/:phone', validatePhone, async (req, res) => {
  try {
    const { phone } = req.params;
    const reservations = await Reservation.find({ 
      phone, 
      status: { $in: ['pending', 'confirmed'] },
      reservationTime: { $gte: new Date() }
    }).sort({ reservationTime: 1 });
    
    res.json({ success: true, reservations });
  } catch (error) {
    console.error('Get reservations error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reservations' });
  }
});

// Cancel reservation
app.patch('/api/reservations/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }
    
    const reservation = await Reservation.findOneAndUpdate(
      { _id: id, phone, status: { $in: ['pending', 'confirmed'] } },
      { status: 'cancelled' },
      { new: true }
    );
    
    if (!reservation) {
      return res.status(404).json({ success: false, error: 'Reservation not found' });
    }
    
    res.json({ success: true, message: 'Reservation cancelled successfully' });
  } catch (error) {
    console.error('Cancel reservation error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel reservation' });
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  connectDB();
});