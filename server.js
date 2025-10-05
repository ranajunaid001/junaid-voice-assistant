const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static('public'));

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', connections: wss.clients.size });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    // Connection state
    let isActive = false;
    let audioBuffer = [];
    let transcriptionTimeout = null;
    
    // Send initial state
    ws.send(JSON.stringify({
        type: 'state',
        state: 'idle'
    }));
    
    // Handle incoming messages
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'start':
                    console.log('Starting conversation');
                    isActive = true;
                    audioBuffer = [];
                    ws.send(JSON.stringify({
                        type: 'state',
                        state: 'listening'
                    }));
                    break;
                    
                case 'stop':
                    console.log('Stopping conversation');
                    isActive = false;
                    audioBuffer = [];
                    if (transcriptionTimeout) {
                        clearTimeout(transcriptionTimeout);
                    }
                    ws.send(JSON.stringify({
                        type: 'state',
                        state: 'idle'
                    }));
                    break;
                    
                case 'audio':
                    if (isActive && data.data) {
                        // Add audio data to buffer
                        audioBuffer.push(...data.data);
                        
                        // Process audio in chunks (every 1 second of audio)
                        if (audioBuffer.length >= 16000) { // ~1 second at 16kHz
                            processAudioChunk(ws, audioBuffer.splice(0, 16000));
                        }
                        
                        // Set timeout to process remaining audio
                        if (transcriptionTimeout) {
                            clearTimeout(transcriptionTimeout);
                        }
                        transcriptionTimeout = setTimeout(() => {
                            if (audioBuffer.length > 0) {
                                processAudioChunk(ws, audioBuffer.splice(0));
                            }
                        }, 300); // Process after 300ms of silence
                    }
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Process audio chunk (placeholder for now)
async function processAudioChunk(ws, audioData) {
    try {
        console.log(`Processing audio chunk: ${audioData.length} samples`);
        
        // For now, just send back a mock transcript
        // TODO: Integrate with Whisper API
        ws.send(JSON.stringify({
            type: 'transcript',
            text: 'Hello, I heard you speaking...',
            final: false
        }));
        
        // Simulate processing
        ws.send(JSON.stringify({
            type: 'state',
            state: 'processing'
        }));
        
        // After a delay, send mock response
        setTimeout(() => {
            ws.send(JSON.stringify({
                type: 'response',
                text: 'This is a test response. Whisper integration coming next!'
            }));
            
            ws.send(JSON.stringify({
                type: 'state',
                state: 'listening'
            }));
        }, 1000);
        
    } catch (error) {
        console.error('Error processing audio:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Error processing audio'
        }));
    }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
