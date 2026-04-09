const ytService = require('../services/ytService');
const { sanitizeFilename } = require('../utils/helpers');

async function getMediaInfo(req, res) {
  try {
    const { url } = req.body;
    const data = await ytService.fetchMediaInfo(url);
    res.json(data);
  } catch (err) {
    console.error('Error in getMediaInfo:', err.message);
    res.status(400).json({ error: err.message });
  }
}

async function streamMedia(req, res) {
  try {
    const { url, videoSpec, audioSpec, type } = req.query;
    let filename = req.query.filename || (type === 'audio' ? 'audio.mp3' : 'video.mp4');
    filename = sanitizeFilename(filename);

    await ytService.streamMergedFile(url, videoSpec, audioSpec, type, res, filename);
  } catch (err) {
    console.error('Error in streamMedia:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

async function proxyFile(req, res) {
  const { url, filename = 'download' } = req.query;
  const http = require('http');
  const https = require('https');

  const protocol = url.startsWith('https') ? https : http;
  const request = protocol.get(url, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      const redirectUrl = response.headers.location;
      return res.redirect(redirectUrl);
    }
    if (response.statusCode !== 200) {
      return res.status(response.statusCode).json({ error: 'Failed to fetch file' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
    response.pipe(res);
  });
  request.on('error', (err) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy failed' });
  });
  request.setTimeout(60000, () => request.destroy());
}

module.exports = {
  getMediaInfo,
  streamMedia,
  proxyFile
};