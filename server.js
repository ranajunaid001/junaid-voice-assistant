const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Groq configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

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
                    // Send debug message to UI
                    ws.send(JSON.stringify({
                        type: 'transcript',
                        text: '[Debug] Listening started...',
                        final: false
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
                        // Debug: Log that audio is received
                        console.log(`Received audio data: ${data.data.length} samples`);
                        
                        // Send debug to UI every 10th message
                        if (Math.random() < 0.1) {
                            ws.send(JSON.stringify({
                                type: 'transcript',
                                text: `[Debug] Receiving audio... buffer: ${audioBuffer.length}`,
                                final: false
                            }));
                        }
                        
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

// Convert Int16Array to WAV format
function createWavFile(audioData, sampleRate = 16000) {
    const length = audioData.length;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Audio data
    let offset = 44;
    for (let i = 0; i < length; i++) {
        view.setInt16(offset, audioData[i], true);
        offset += 2;
    }
    
    return Buffer.from(buffer);
}

// Transcribe audio using Groq Whisper
async function transcribeAudio(audioBuffer) {
    try {
        console.log('Calling Groq API with audio buffer size:', audioBuffer.length);
        
        const form = new FormData();
        form.append('file', audioBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav'
        });
        form.append('model', 'whisper-large-v3');
        form.append('response_format', 'json');
        form.append('language', 'en');
        
        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                ...form.getHeaders()
            },
            body: form
        });
        
        if (!response.ok) {
            const error = await response.text();
            console.error('Groq API error response:', error);
            throw new Error(`Groq API error: ${response.status} - ${error}`);
        }
        
        const data = await response.json();
        console.log('Groq response:', data);
        return data.text;
        
    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
}

// Process audio chunk with real Whisper
async function processAudioChunk(ws, audioData) {
    try {
        console.log(`Processing audio chunk: ${audioData.length} samples`);
        
        // Convert audio data to WAV format
        const audioArray = new Int16Array(audioData);
        const wavBuffer = createWavFile(audioArray);
        
        // Send to Groq Whisper
        const transcript = await transcribeAudio(wavBuffer);
        
        if (transcript && transcript.trim()) {
            console.log('Transcript:', transcript);
            
            // Send transcript to client
            ws.send(JSON.stringify({
                type: 'transcript',
                text: transcript,
                final: true
            }));
            
            // Update state
            ws.send(JSON.stringify({
                type: 'state',
                state: 'processing'
            }));
            
            // For now, just echo back the transcript
            // TODO: Add LLM processing here
            setTimeout(() => {
                ws.send(JSON.stringify({
                    type: 'response',
                    text: `I heard you say: "${transcript}"`
                }));
                
                ws.send(JSON.stringify({
                    type: 'state',
                    state: 'listening'
                }));
            }, 500);
        }
        
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
