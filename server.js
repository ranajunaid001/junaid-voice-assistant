const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

// Import AWS SDK at the top
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

// Import Google Cloud Text-to-Speech
const textToSpeech = require('@google-cloud/text-to-speech');

// Import Pinecone and OpenAI for RAG
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Groq configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Configure AWS Polly
const pollyClient = new PollyClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Configure Google TTS
const googleTTSClient = new textToSpeech.TextToSpeechClient({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS)
});

// Configure OpenAI and Pinecone for RAG
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index('junaid-assistant', process.env.PINECONE_HOST);

// TTS configuration - stores current settings
let ttsConfig = {
    service: 'aws',  // Switch to AWS
    awsVoice: 'Ruth',  // AWS Polly female generative voice
    googleVoice: 'Aoede',  // Google Gemini-TTS voice - female
    googleModel: 'gemini-2.5-flash-tts'  // Gemini TTS model
};

// Available voices configuration
const availableVoices = {
    aws: {
        'Stephen': { gender: 'Male', engine: 'generative' },
        'Ruth': { gender: 'Female', engine: 'generative' },
        'Matthew': { gender: 'Male', engine: 'neural' },
        'Joanna': { gender: 'Female', engine: 'neural' }
    },
    google: {
        'Enceladus': { gender: 'Male', model: 'gemini-2.5-flash-tts' },
        'Aoede': { gender: 'Female', model: 'gemini-2.5-flash-tts' },
        'Schedar': { gender: 'Male', model: 'gemini-2.5-flash-tts' },
        'Umbriel': { gender: 'Male', model: 'gemini-2.5-flash-tts' }
    }
};

// Serve static files
app.use(express.static('public'));

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', connections: wss.clients.size });
});

// Get available voices endpoint
app.get('/api/voices', (req, res) => {
    res.json({
        currentConfig: ttsConfig,
        availableVoices: availableVoices
    });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    // Connection state
    let isActive = false;
    let audioBuffer = [];
    let transcriptionTimeout = null;
    let isSpeaking = false;
    
    // Send initial state with TTS config
    ws.send(JSON.stringify({
        type: 'state',
        state: 'idle',
        ttsConfig: ttsConfig
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
                    
                case 'setTTS':
                    // Handle TTS configuration changes
                    if (data.config) {
                        // Update service
                        if (data.config.service && (data.config.service === 'aws' || data.config.service === 'google')) {
                            ttsConfig.service = data.config.service;
                        }
                        
                        // Update AWS voice
                        if (data.config.awsVoice && availableVoices.aws[data.config.awsVoice]) {
                            ttsConfig.awsVoice = data.config.awsVoice;
                        }
                        
                        // Update Google voice
                        if (data.config.googleVoice && availableVoices.google[data.config.googleVoice]) {
                            ttsConfig.googleVoice = data.config.googleVoice;
                        }
                        
                        // Update Google model
                        if (data.config.googleModel && (data.config.googleModel === 'gemini-2.5-flash-tts' || data.config.googleModel === 'gemini-2.5-pro-tts')) {
                            ttsConfig.googleModel = data.config.googleModel;
                        }
                        
                        console.log('TTS configuration updated:', ttsConfig);
                        ws.send(JSON.stringify({
                            type: 'ttsConfigUpdated',
                            ttsConfig: ttsConfig
                        }));
                    }
                    break;
                    
                case 'audio':
                    if (data.data) {
                        // Check if user is interrupting while assistant is speaking
                        // Lowered threshold for more sensitive interruption detection
                        if (isSpeaking && data.data.some(sample => Math.abs(sample) > 500)) {
                            console.log('User interruption detected');
                            
                            // Stop TTS
                            ws.send(JSON.stringify({
                                type: 'command',
                                action: 'stopAudio'
                            }));
                            
                            // Reset state
                            isSpeaking = false;
                            isActive = true;
                            audioBuffer = [];
                            
                            ws.send(JSON.stringify({
                                type: 'state',
                                state: 'listening'
                            }));
                        }
                        
                        if (isActive) {
                            // Debug: Log that audio is received
                            console.log(`Received audio data: ${data.data.length} samples`);
                            
                            // Add audio data to buffer
                            audioBuffer.push(...data.data);
                            
                            // Only process if buffer is getting too large (safety limit)
                            if (audioBuffer.length >= 160000) { // ~10 seconds at 16kHz
                                processAudioChunk(ws, audioBuffer.splice(0, 160000));
                            }
                            
                            // Set timeout to process remaining audio
                            if (transcriptionTimeout) {
                                clearTimeout(transcriptionTimeout);
                            }
                            transcriptionTimeout = setTimeout(() => {
                                if (audioBuffer.length > 0) {
                                    processAudioChunk(ws, audioBuffer.splice(0));
                                }
                            }, 2000); // Wait 2 seconds of silence
                        }
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
    
    // Add function reference to WebSocket object for access in processAudioChunk
    ws.isSpeaking = () => isSpeaking;
    ws.setIsSpeaking = (value) => { isSpeaking = value; };
    ws.isActive = () => isActive;
    ws.setIsActive = (value) => { isActive = value; };
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

// Text-to-Speech router function
async function textToSpeechRouter(text) {
    if (ttsConfig.service === 'google') {
        return await googleTextToSpeech(text);
    } else {
        return await awsTextToSpeech(text);
    }
}

// AWS Polly Text-to-Speech
async function awsTextToSpeech(text) {
    try {
        console.log(`Calling Amazon Polly TTS (${ttsConfig.awsVoice}) with:`, text.substring(0, 50) + '...');
        
        // Get voice configuration
        const voiceConfig = availableVoices.aws[ttsConfig.awsVoice];
        
        const params = {
            Text: text,
            OutputFormat: 'mp3',
            VoiceId: ttsConfig.awsVoice,
            SampleRate: '24000',
            Engine: voiceConfig.engine  // Use the engine specified for this voice
        };
        
        const command = new SynthesizeSpeechCommand(params);
        const response = await pollyClient.send(command);
        
        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of response.AudioStream) {
            chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);
        
        console.log(`Polly TTS audio received (${voiceConfig.engine} engine, MP3), size:`, audioBuffer.length);
        
        return audioBuffer;
        
    } catch (error) {
        console.error('AWS TTS error:', error);
        return null;
    }
}

// Google Cloud Text-to-Speech with Gemini-TTS
async function googleTextToSpeech(text) {
    try {
        console.log(`Calling Google Gemini-TTS (${ttsConfig.googleVoice}) with:`, text.substring(0, 50) + '...');
        
        // Log the exact configuration being used
        console.log('Google TTS Config:', {
            voice: ttsConfig.googleVoice,
            model: ttsConfig.googleModel
        });
        
        // According to the documentation, the correct structure is:
        const request = {
            input: { 
                text: text,
                prompt: "You are having a friendly conversation. Speak naturally and conversationally."
            },
            voice: {
                languageCode: 'en-US',
                name: ttsConfig.googleVoice,  // e.g., "Enceladus"
                modelName: ttsConfig.googleModel  // e.g., "gemini-2.5-flash-tts"
            },
            audioConfig: {
                audioEncoding: 'MP3'
            }
        };
        
        console.log('Sending request to Google TTS...');
        console.log('Full request:', JSON.stringify(request, null, 2));
        
        const [response] = await googleTTSClient.synthesizeSpeech(request);
        console.log('Got response from Google TTS');
        
        if (!response || !response.audioContent) {
            console.error('No audio content in response');
            return null;
        }
        
        const audioBuffer = Buffer.from(response.audioContent, 'base64');
        
        console.log('Gemini-TTS audio received (MP3), size:', audioBuffer.length);
        
        return audioBuffer;
        
    } catch (error) {
        console.error('Google TTS error:', error.message);
        console.error('Error code:', error.code);
        console.error('Error details:', error.details);
        console.error('Full error:', error);
        return null;
    }
}

// Add this helper function after textToSpeech
function createWavFromPCM(pcmBuffer, sampleRate = 16000) {
    const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);
    
    // WAV header
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16); // fmt chunk size
    wavBuffer.writeUInt16LE(1, 20); // PCM format
    wavBuffer.writeUInt16LE(1, 22); // Mono
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    wavBuffer.writeUInt16LE(2, 32); // block align
    wavBuffer.writeUInt16LE(16, 34); // bits per sample
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
    
    // Copy PCM data
    pcmBuffer.copy(wavBuffer, 44);
    
    return wavBuffer;
}

// Search knowledge base function for RAG
async function searchKnowledge(query) {
    try {
        const embedding = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: query,
        });
        
        const results = await index.query({
            vector: embedding.data[0].embedding,
            topK: 3,
            includeMetadata: true
        });
        
        const context = results.matches
            .map(match => match.metadata.text)
            .join('\n\n');
        
        return context;
    } catch (error) {
        console.error('Search error:', error);
        return '';
    }
}

// Call Groq LLM for response
async function getLLMResponse(transcript) {
    try {
        console.log('Calling Groq LLM with:', transcript);
        
        // Search for relevant context
        const context = await searchKnowledge(transcript);
        console.log('Found context:', context ? 'Yes' : 'No');
        
        // Build messages with context
        const messages = [
            {
                role: 'system',
                content: `You are Junaid speaking in first person. You have knowledge about your work on AI contact center solutions, voice assistants, and other projects. Use the provided context to answer questions accurately. Keep responses concise and natural for speech. If asked about something not in your knowledge, politely say you haven't worked on that specific area.

Context: ${context}`
            },
            {
                role: 'user',
                content: transcript
            }
        ];
        
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: messages,
                temperature: 0.7,
                max_tokens: 150
            })
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`LLM API error: ${response.status} - ${error}`);
        }
        
        const data = await response.json();
        console.log('LLM response:', data.choices[0].message.content);
        return data.choices[0].message.content;
        
    } catch (error) {
        console.error('LLM error:', error);
        return "I'm sorry, I couldn't process that. Please try again.";
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
            // Filter out very short transcripts and common noise
            const cleanTranscript = transcript.trim();
            if (cleanTranscript.length < 5 || 
                cleanTranscript.toLowerCase() === 'okay.' ||
                cleanTranscript.toLowerCase() === 'thank you.' ||
                cleanTranscript === '.') {
                console.log('Ignoring short/noise transcript:', cleanTranscript);
                return; // Skip processing
            }
            
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
            
            // Get LLM response
            console.log('Getting LLM response...');
            const llmResponse = await getLLMResponse(transcript);
            console.log('LLM response received');
            
            // Send LLM response text
            console.log('Sending response to client...');
            ws.send(JSON.stringify({
                type: 'response',
                text: llmResponse
            }));
            
            // Update state to speaking
            ws.send(JSON.stringify({
                type: 'state',
                state: 'speaking'
            }));
            
            // Stop capturing audio while speaking
            ws.setIsSpeaking(true);
            ws.setIsActive(false);
            
            // Generate TTS audio using selected service
            console.log(`Calling TTS router with service: ${ttsConfig.service}`);
            const audioBuffer = await textToSpeechRouter(llmResponse);
            console.log('TTS router returned, audioBuffer:', audioBuffer ? 'exists' : 'null');
            
            if (audioBuffer) {
                // Send audio as base64
                const audioBase64 = audioBuffer.toString('base64');
                console.log('Sending audio to client, size:', audioBase64.length);
                ws.send(JSON.stringify({
                    type: 'audio',
                    data: audioBase64,
                    format: 'mp3'  // Both services output MP3
                }));
            } else {
                console.error('No audio buffer returned from TTS');
            }
            
            // Back to listening
            ws.send(JSON.stringify({
                type: 'state',
                state: 'listening'
            }));
            ws.setIsSpeaking(false);
            ws.setIsActive(true);
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
    console.log('TTS Configuration:', ttsConfig);
    console.log('Available voices:', availableVoices);
});
