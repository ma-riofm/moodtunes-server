const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

// Step 1: Get Google auth URL
app.get('/auth/url', (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube'],
  });
  res.json({ url });
});

// Step 2: Exchange code for tokens
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    // Redirect back to app with tokens
    const params = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || ''
    });
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    res.redirect(`${appUrl}?${params.toString()}`);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 3: Create playlist
app.post('/create-playlist', async (req, res) => {
  const { access_token, refresh_token, title, mood, songs } = req.body;
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token, refresh_token });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Create playlist
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

    // Search and add each song
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
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        errors.push(song.title);
      }
    }

    res.json({
      success: true,
      playlistId,
      playlistUrl: `https://music.youtube.com/playlist?list=${playlistId}`,
      errors
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'MoodTunes server running ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
