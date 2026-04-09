const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { mergeVideoAudio } = require('../utils/ffmpeg');

const execPromise = promisify(exec);
const TEMP_DIR = path.join(__dirname, '../../temp');

/**
 * Download a file from a URL and save it to a local path.
 * @param {string} url - Direct download URL
 * @param {string} outputPath - Local file path
 * @returns {Promise} Resolves when download finishes
 */
async function downloadFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    method: 'get',
    url: url,
    responseType: 'stream',
    timeout: 60000
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Get direct download URLs for video and audio streams using yt-dlp.
 * @param {string} url - Original media URL
 * @param {string} videoSpec - yt-dlp format spec for video (e.g., "bestvideo[height<=1080][ext=mp4]")
 * @param {string} audioSpec - yt-dlp format spec for audio (e.g., "bestaudio[ext=m4a]")
 * @returns {Promise<{videoUrl: string, audioUrl: string}>}
 */
async function getStreamUrls(url, videoSpec, audioSpec) {
  try {
    // Get video URL
    const videoCmd = `yt-dlp -f "${videoSpec}" --get-url "${url}"`;
    const { stdout: videoStdout } = await execPromise(videoCmd, { timeout: 30000 });
    const videoUrl = videoStdout.trim().split('\n')[0];

    // Get audio URL (if audioSpec provided)
    let audioUrl = null;
    if (audioSpec) {
      const audioCmd = `yt-dlp -f "${audioSpec}" --get-url "${url}"`;
      const { stdout: audioStdout } = await execPromise(audioCmd, { timeout: 30000 });
      audioUrl = audioStdout.trim().split('\n')[0];
    }

    return { videoUrl, audioUrl };
  } catch (err) {
    console.error('Error getting stream URLs:', err.message);
    throw new Error(`Failed to get stream URLs: ${err.message}`);
  }
}

/**
 * Fetch media info using yt-dlp -j (same as before, but we keep it)
 */
async function fetchMediaInfo(url) {
  console.log(`Fetching media info for: ${url}`);
  const escapedUrl = url.replace(/[&$!]/g, '\\$&');
  const command = `yt-dlp -j --no-playlist "${escapedUrl}"`;

  try {
    const { stdout } = await execPromise(command, { maxBuffer: 20 * 1024 * 1024, timeout: 60000 });
    const info = JSON.parse(stdout);
    const title = (info.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '');
    const thumbnail = info.thumbnail || '';
    const formats = info.formats || [];
    const media = [];

    // Separate video and audio formats
    const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.url);
    const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none' && f.url);

    // Build available resolutions
    const resolutions = new Map();
    for (const fmt of videoFormats) {
      const height = fmt.height;
      if (!height) continue;
      if (!resolutions.has(height) || fmt.tbr > resolutions.get(height).tbr) {
        resolutions.set(height, fmt);
      }
    }
    const sortedResolutions = Array.from(resolutions.keys()).sort((a, b) => b - a);

    for (const height of sortedResolutions) {
      const fmt = resolutions.get(height);
      let qualityLabel = '';
      if (height >= 2160) qualityLabel = `4K (${height}p) - Best Quality`;
      else if (height >= 1440) qualityLabel = `2K (${height}p) - High Quality`;
      else if (height >= 1080) qualityLabel = `Full HD (${height}p) - Best Quality`;
      else if (height >= 720) qualityLabel = `HD (${height}p) - High Quality`;
      else if (height >= 480) qualityLabel = `SD (${height}p) - Standard Quality`;
      else qualityLabel = `${height}p`;

      // We'll store the video spec (to get the video stream) and a separate audio spec
      const videoSpec = `bestvideo[height<=${height}][ext=mp4]`;
      const audioSpec = 'bestaudio[ext=m4a]'; // best audio format

      media.push({
        type: 'video',
        quality: qualityLabel,
        originalUrl: url,
        videoSpec: videoSpec,
        audioSpec: audioSpec,
        ext: 'mp4',
        size: fmt.filesize || fmt.filesize_approx || null,
        downloadUrl: `/api/stream?url=${encodeURIComponent(url)}&videoSpec=${encodeURIComponent(videoSpec)}&audioSpec=${encodeURIComponent(audioSpec)}&type=video`
      });
    }

    // Audio only
    if (audioFormats.length > 0) {
      const bestAudio = audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
      media.push({
        type: 'audio',
        quality: `${Math.round(bestAudio.abr || 192)}kbps MP3`,
        originalUrl: url,
        videoSpec: null,
        audioSpec: 'bestaudio',
        ext: 'mp3',
        size: bestAudio.filesize || bestAudio.filesize_approx || null,
        downloadUrl: `/api/stream?url=${encodeURIComponent(url)}&videoSpec=&audioSpec=bestaudio&type=audio`
      });
    }

    // Image detection
    if (info.url && /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(info.url)) {
      media.push({
        type: 'image',
        quality: 'Original',
        url: info.url,
        ext: path.extname(info.url).slice(1),
        size: info.filesize || null,
        downloadUrl: info.url
      });
    }

    console.log(`Processed ${media.length} media options`);
    return { title, thumbnail, media, success: true };

  } catch (err) {
    console.error('Error in fetchMediaInfo:', err.message);
    throw new Error(`Failed to fetch media: ${err.message}`);
  }
}

/**
 * Stream a merged file using ffmpeg.js (downloads video & audio separately, then merges)
 */
async function streamMergedFile(url, videoSpec, audioSpec, type, res, filename) {
  const tempId = uuidv4();
  const videoPath = path.join(TEMP_DIR, `${tempId}_video.mp4`);
  const audioPath = path.join(TEMP_DIR, `${tempId}_audio.m4a`);
  const outputPath = path.join(TEMP_DIR, `${tempId}_merged.mp4`);

  try {
    if (type === 'audio') {
      // Audio only: just download audio and stream directly (no merge)
      const audioUrl = await getStreamUrls(url, null, audioSpec).then(urls => urls.audioUrl);
      if (!audioUrl) throw new Error('No audio URL found');
      await downloadFile(audioUrl, outputPath); // we'll rename later
      const stat = await fs.stat(outputPath);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on('end', () => fs.unlink(outputPath).catch(() => {}));
      readStream.on('error', (err) => {
        console.error('Audio stream error:', err);
        fs.unlink(outputPath).catch(() => {});
      });
    } else {
      // Video + audio: download both, merge using ffmpeg.js
      const { videoUrl, audioUrl } = await getStreamUrls(url, videoSpec, audioSpec);
      if (!videoUrl) throw new Error('No video URL found');
      if (!audioUrl) {
        // If no separate audio, maybe the video already contains audio
        console.log('No separate audio stream found; falling back to direct video download');
        await downloadFile(videoUrl, outputPath);
      } else {
        // Download video and audio concurrently
        await Promise.all([
          downloadFile(videoUrl, videoPath),
          downloadFile(audioUrl, audioPath)
        ]);
        // Merge them
        await mergeVideoAudio(videoPath, audioPath, outputPath);
        // Clean up temporary video/audio files
        await fs.unlink(videoPath).catch(() => {});
        await fs.unlink(audioPath).catch(() => {});
      }

      const stat = await fs.stat(outputPath);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'video/mp4');
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on('end', () => {
        fs.unlink(outputPath).catch(() => {});
      });
      readStream.on('error', (err) => {
        console.error('Video stream error:', err);
        fs.unlink(outputPath).catch(() => {});
      });
    }
  } catch (err) {
    console.error('Streaming error:', err);
    // Clean up any leftover files
    await fs.remove(videoPath).catch(() => {});
    await fs.remove(audioPath).catch(() => {});
    await fs.remove(outputPath).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to process media: ${err.message}` });
    }
    throw err;
  }
}

module.exports = {
  fetchMediaInfo,
  streamMergedFile
};