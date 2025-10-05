const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Pakistan Complaint System is running',
    timestamp: new Date().toISOString()
  });
});

// API endpoint for assistant configuration
app.get('/api/config', (req, res) => {
  res.json({
    assistantId: process.env.UPLIFT_ASSISTANT_ID || 'db05d122-2c23-4869-a730-6679521014f3',
    assistantUrl: `https://platform.upliftai.org/assistant/${process.env.UPLIFT_ASSISTANT_ID || 'db05d122-2c23-4869-a730-6679521014f3'}`,
    apiKey: process.env.UPLIFT_API_KEY ? 'Configured' : 'Not configured'
  });
});

// API endpoint to store complaints
app.post('/api/complaints', (req, res) => {
  const { name, location, department, complaint, ticketNumber } = req.body;
  
  console.log('New complaint received:', {
    name,
    location,
    department,
    complaint,
    ticketNumber,
    timestamp: new Date().toISOString()
  });
  
  res.json({
    success: true,
    message: 'Complaint registered successfully',
    ticketNumber: ticketNumber || `PKG-${Date.now().toString().slice(-8)}`
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Pakistan Complaint System is running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
});
