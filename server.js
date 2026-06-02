const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const https = require('https');
const app = express();

app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// Generate playlist via Anthropic
app.post('/generate-playlist', async (req, res) => {
  const { mood, genre } = req.body;
  const prompt = `Eres un experto DJ y curador de música latina y en español. El usuario se siente: "${mood}". Quiere escuchar: "${genre}".

Genera una playlist de EXACTAMENTE 25 canciones perfectas para ese estado de ánimo y estilo musical. Varía entre canciones muy conocidas y algunas joyas menos populares.

RESPONDE SOLO con JSON válido, sin texto extra, sin markdown, sin backticks:
{
  "playlist_title": "título creativo en español máximo 4 palabras",
  "mood_label": "1-2 palabras del mood",
  "emoji": "un emoji que represente la playlist",
  "songs": [
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artist": "artista", "year": "año"},
    {"title": "nombre exacto", "artista": "artista", "year": "año"}
  ]
}`;

  try {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const data = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let raw = '';
        response.on('data', chunk => raw += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch(e) { reject(new Error('Invalid JSON from Anthropic')); }
        });
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });

    const text = data.content.map(i => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Auth URL
app.get('/auth/url', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube'],
  });
  res.json({ url });
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    const params = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || ''
    });
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    res.redirect(`${appUrl}?${params.toString()}`);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Create playlist
app.post('/create-playlist', async (req, res) => {
  const { access_token, refresh_token, title, mood, songs } = req.body;
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token, refresh_token });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const playlist = await youtube.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: `🎵 ${title}`,
          description: `Playlist generada por MoodTunes — Mood: ${mood}`
        },
        status: { privacyStatus: 'private' }
      }
    });

    const playlistId = playlist.data.id;
    const errors = [];

    for (const song of songs) {
      try {
        const search = await youtube.search.list({
          part: ['snippet'],
          q: `${song.title} ${song.artist} official`,
          type: ['video'],
          maxResults: 1
        });
        if (search.data.items && search.data.items.length > 0) {
          const videoId = search.data.items[0].id.videoId;
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId,
                resourceId: { kind: 'youtube#video', videoId }
              }
            }
          });
        }
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        errors.push(song.title);
      }
    }

    res.json({
      success: true,
      playlistId,
      playlistUrl: `https://music.youtube.com/playlist?list=${playlistId}`,
      errors
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'MoodTunes server running ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
