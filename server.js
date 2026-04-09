// ========== FOR RENDER DEPLOYMENT ==========
// 👇 ADD YOUR VERCEL FRONTEND URL HERE
const ALLOWED_ORIGINS = [
    'https://downx-web.vercel.app/',  // CHANGE THIS LINE
    'http://localhost:3000',
    'http://localhost:5500'
];
// ===========================================

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mime = require('mime-types');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false
}));

// ========== CORS WITH VERCEL FRONTEND ==========
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('Origin not allowed:', origin);
            callback(null, true); // Allow anyway for testing, change in production
        }
    },
    credentials: true
}));
// ===============================================

app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const config = {
    tempDir: path.join(__dirname, 'temp'),
    cookiesFile: path.join(__dirname, 'cookies.txt'),
    maxFileSize: 1024 * 1024 * 1024,
    downloadTimeout: 300000,
    retryAttempts: 3,
    retryDelay: 1000
};

// Ensure directories exist
fs.ensureDirSync(config.tempDir);

// Clean old temp files every hour
setInterval(async () => {
    try {
        const files = await fs.readdir(config.tempDir);
        const now = Date.now();
        
        for (const file of files) {
            const filePath = path.join(config.tempDir, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtimeMs > 3600000) {
                await fs.remove(filePath);
                console.log(`🧹 Cleaned: ${file}`);
            }
        }
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 3600000);

// Helper functions
function sanitizeFilename(filename) {
    return filename
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function checkCookies() {
    try {
        return fs.existsSync(config.cookiesFile);
    } catch (err) {
        return false;
    }
}

async function retry(fn, attempts = config.retryAttempts, delay = config.retryDelay) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === attempts - 1) throw err;
            console.log(`Retry ${i + 1}/${attempts} after error: ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}

// Execute yt-dlp command
async function executeYtDlp(url, outputPath, options = {}) {
    const {
        format = 'bv*+ba/best',
        extractAudio = false,
        audioFormat = 'mp3',
        audioQuality = 192,
        getInfo = false,
        cookies = true
    } = options;
    
    let finalFormat = format;
    if (!extractAudio && !getInfo) {
        finalFormat = format.includes('mp4') ? format : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }
    
    const outputTemplate = outputPath ? `-o "${outputPath.replace(/\\/g, '/')}"` : '';
    const cookiesOption = cookies && checkCookies() ? `--cookies "${config.cookiesFile}"` : '';
    const userAgent = '--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"';
    const geoBypass = '--geo-bypass';
    const noCheckCert = '--no-check-certificate';
    const preferFree = '--prefer-free-formats';
    const remuxVideo = '--remux-video mp4';
    const quietFlag = getInfo ? '--quiet --no-warnings' : '';
    
    let command;
    
    if (extractAudio) {
        command = `yt-dlp ${cookiesOption} ${userAgent} ${geoBypass} ${noCheckCert} ${preferFree} -x --audio-format ${audioFormat} --audio-quality ${audioQuality}K ${outputTemplate} "${url}"`;
    } else if (getInfo) {
        command = `yt-dlp ${cookiesOption} ${userAgent} ${geoBypass} ${noCheckCert} ${preferFree} ${quietFlag} -j --no-playlist "${url}"`;
    } else {
        command = `yt-dlp ${cookiesOption} ${userAgent} ${geoBypass} ${noCheckCert} ${preferFree} ${remuxVideo} -f "${finalFormat}" ${outputTemplate} "${url}"`;
    }
    
    console.log(`📥 Executing: ${command.substring(0, 200)}...`);
    
    return new Promise((resolve, reject) => {
        exec(command, { 
            timeout: config.downloadTimeout, 
            maxBuffer: 50 * 1024 * 1024,
            windowsHide: true
        }, (error, stdout, stderr) => {
            if (getInfo) {
                const lines = stdout.split('\n');
                const jsonLines = lines.filter(line => line.trim() && !line.startsWith('WARNING:') && !line.startsWith('[generic]'));
                const cleanOutput = jsonLines.join('\n');
                
                if (error && !cleanOutput.trim()) {
                    reject(new Error(`yt-dlp error: ${error.message}\nStderr: ${stderr}`));
                    return;
                }
                
                try {
                    const jsonMatch = cleanOutput.match(/\{.*\}/s);
                    if (jsonMatch) {
                        resolve(jsonMatch[0]);
                    } else if (cleanOutput.trim()) {
                        try {
                            JSON.parse(cleanOutput.trim());
                            resolve(cleanOutput.trim());
                        } catch (e) {
                            reject(new Error('No valid JSON output from yt-dlp'));
                        }
                    } else {
                        reject(new Error('No output from yt-dlp'));
                    }
                } catch (parseErr) {
                    console.error('JSON parse error:', parseErr);
                    console.error('Raw output:', stdout);
                    reject(new Error(`Failed to parse yt-dlp output: ${parseErr.message}`));
                }
                return;
            }
            
            if (outputPath && !error) {
                const possiblePaths = [
                    outputPath,
                    outputPath.replace('.mp4', '.mkv'),
                    outputPath.replace('.mp4', '.webm')
                ];
                
                const findActualFile = async () => {
                    for (const path of possiblePaths) {
                        if (await fs.pathExists(path)) {
                            const stats = await fs.stat(path);
                            if (stats.size > 0) {
                                if (path !== outputPath) {
                                    console.log(`📝 Renaming ${path} to ${outputPath}`);
                                    await fs.move(path, outputPath, { overwrite: true });
                                }
                                return outputPath;
                            }
                        }
                    }
                    return null;
                };
                
                setTimeout(async () => {
                    try {
                        const actualFile = await findActualFile();
                        if (!actualFile) {
                            console.error('File not created:', outputPath);
                            console.error('yt-dlp stdout:', stdout);
                            console.error('yt-dlp stderr:', stderr);
                            reject(new Error('File not created by yt-dlp'));
                        } else {
                            const stats = await fs.stat(actualFile);
                            console.log(`✅ File created: ${actualFile} (${stats.size} bytes)`);
                            resolve(stdout);
                        }
                    } catch (err) {
                        reject(new Error(`Failed to check file: ${err.message}`));
                    }
                }, 2000);
            } else if (error) {
                if (!extractAudio && !getInfo && outputPath) {
                    console.log('🔄 Primary format failed, trying fallback...');
                    const fallbackCommand = `yt-dlp ${cookiesOption} ${userAgent} ${geoBypass} ${noCheckCert} ${remuxVideo} -f best -o "${outputPath.replace(/\\/g, '/')}" "${url}"`;
                    exec(fallbackCommand, { timeout: config.downloadTimeout, maxBuffer: 50 * 1024 * 1024 }, (fbError, fbStdout) => {
                        if (fbError) {
                            reject(new Error(`Download failed: ${fbError.message}\nStderr: ${stderr}`));
                        } else {
                            setTimeout(async () => {
                                try {
                                    if (await fs.pathExists(outputPath)) {
                                        const stats = await fs.stat(outputPath);
                                        if (stats.size > 0) {
                                            resolve(fbStdout);
                                        } else {
                                            reject(new Error('Fallback created empty file'));
                                        }
                                    } else {
                                        reject(new Error('Fallback also failed to create file'));
                                    }
                                } catch (err) {
                                    reject(new Error(`Fallback file check failed: ${err.message}`));
                                }
                            }, 2000);
                        }
                    });
                    return;
                }
                reject(new Error(`yt-dlp error: ${error.message}\nStderr: ${stderr}`));
                return;
            } else {
                resolve(stdout);
            }
        });
    });
}

// Pinterest URL resolution
async function resolvePinterestUrl(shortUrl) {
    return new Promise((resolve) => {
        let shortCode = shortUrl;
        if (shortUrl.includes('pin.it/')) {
            shortCode = shortUrl.split('pin.it/')[1];
        }
        shortCode = shortCode.split('?')[0];
        
        console.log(`📌 Pinterest short code: ${shortCode}`);
        
        const options = {
            method: 'GET',
            hostname: 'pin.it',
            path: `/${shortCode}`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };
        
        const req = https.request(options, (res) => {
            let location = res.headers.location;
            if (location && !location.includes('api.pinterest.com')) {
                console.log(`📌 Resolved to: ${location}`);
                resolve(location);
            } else {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    const pinMatch = body.match(/https?:\/\/www\.pinterest\.com\/pin\/[0-9]+/);
                    if (pinMatch) {
                        console.log(`📌 Extracted from HTML: ${pinMatch[0]}`);
                        resolve(pinMatch[0]);
                    } else {
                        console.log('📌 Using original URL for yt-dlp');
                        resolve(shortUrl);
                    }
                });
            }
        });
        
        req.on('error', (err) => {
            console.log('⚠️ Pinterest redirect error, using original URL');
            resolve(shortUrl);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            resolve(shortUrl);
        });
        req.end();
    });
}

// Fetch media info
async function fetchMediaInfo(url) {
    let finalUrl = url;
    if (url.includes('pin.it')) {
        try {
            finalUrl = await resolvePinterestUrl(url);
            console.log(`📌 Final URL for fetch: ${finalUrl}`);
        } catch (err) {
            console.log('⚠️ Could not resolve Pinterest URL, using original');
        }
    }
    
    const stdout = await executeYtDlp(finalUrl, null, { getInfo: true });
    
    let info;
    try {
        info = JSON.parse(stdout);
    } catch (parseErr) {
        console.error('Failed to parse JSON. Raw output:', stdout.substring(0, 500));
        throw new Error(`Invalid response from yt-dlp: ${parseErr.message}`);
    }
    
    const title = (info.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '');
    const uploader = info.uploader || info.channel || info.uploader_id || 'Unknown';
    const duration = info.duration ? formatDuration(info.duration) : '';
    const description = (info.description || '').substring(0, 200);
    
    let thumbnail = '';
    if (info.thumbnail) thumbnail = info.thumbnail;
    if (!thumbnail && info.thumbnails && info.thumbnails.length > 0) {
        const bestThumb = info.thumbnails
            .filter(t => t.url)
            .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        if (bestThumb) thumbnail = bestThumb.url;
    }
    
    if (thumbnail && (thumbnail.includes('instagram.com') || thumbnail.includes('cdninstagram'))) {
        thumbnail = `/api/proxy-image?url=${encodeURIComponent(thumbnail)}`;
    }
    
    const formats = info.formats || [];
    const media = [];
    
    if (finalUrl.includes('pinterest.com')) {
        console.log('📌 Processing Pinterest content');
        const videos = formats.filter(f => f.vcodec !== 'none' && f.url);
        
        if (videos.length > 0) {
            const heights = [...new Set(videos.map(f => f.height || 720).filter(h => h))].sort((a, b) => b - a);
            for (const height of heights.slice(0, 3)) {
                let qualityLabel = height >= 1080 ? `Full HD (${height}p)` : (height >= 720 ? `HD (${height}p)` : `${height}p`);
                media.push({ type: 'video', quality: qualityLabel, height: height });
            }
            media.push({ type: 'audio', quality: '192kbps MP3', bitrate: 192 });
        } else {
            const images = formats.filter(f => f.ext === 'jpg' || f.ext === 'png' || f.ext === 'webp');
            if (images.length > 0) {
                media.push({ type: 'image', quality: 'Original Image', url: images[0].url });
            }
        }
    } 
    else if (finalUrl.includes('threads.net')) {
        console.log('🧵 Processing Threads content');
        const videos = formats.filter(f => f.vcodec !== 'none' && f.url);
        
        if (videos.length > 0) {
            const heights = [...new Set(videos.map(f => f.height || 720).filter(h => h))].sort((a, b) => b - a);
            for (const height of heights.slice(0, 3)) {
                let qualityLabel = height >= 1080 ? `Full HD (${height}p)` : (height >= 720 ? `HD (${height}p)` : `${height}p`);
                media.push({ type: 'video', quality: qualityLabel, height: height });
            }
            media.push({ type: 'audio', quality: '192kbps MP3', bitrate: 192 });
        } else {
            const images = formats.filter(f => f.ext === 'jpg' || f.ext === 'png');
            if (images.length > 0) {
                media.push({ type: 'image', quality: 'Original Image', url: images[0].url });
            }
        }
    }
    else if (finalUrl.includes('instagram.com')) {
        console.log('📸 Processing Instagram content');
        const videos = formats.filter(f => f.vcodec !== 'none' && f.url);
        
        if (videos.length > 0) {
            const heights = [...new Set(videos.map(f => f.height || 720).filter(h => h))].sort((a, b) => b - a);
            for (const height of heights.slice(0, 3)) {
                let qualityLabel = height >= 1080 ? `Full HD (${height}p)` : (height >= 720 ? `HD (${height}p)` : `${height}p`);
                media.push({ type: 'video', quality: qualityLabel, height: height });
            }
            media.push({ type: 'audio', quality: '192kbps MP3', bitrate: 192 });
        } else {
            const images = formats.filter(f => f.ext === 'jpg' || f.ext === 'png');
            if (images.length > 0) {
                media.push({ type: 'image', quality: 'Original Image', url: images[0].url });
            }
        }
    }
    else {
        const videos = formats.filter(f => f.height && f.vcodec !== 'none' && f.url);
        const heights = [...new Set(videos.map(f => f.height))].sort((a, b) => b - a);
        
        for (const height of heights.slice(0, 5)) {
            let qualityLabel = '';
            if (height >= 2160) qualityLabel = `4K (${height}p)`;
            else if (height >= 1440) qualityLabel = `2K (${height}p)`;
            else if (height >= 1080) qualityLabel = `Full HD (${height}p)`;
            else if (height >= 720) qualityLabel = `HD (${height}p)`;
            else if (height >= 480) qualityLabel = `SD (${height}p)`;
            else qualityLabel = `${height}p`;
            
            media.push({ type: 'video', quality: qualityLabel, height: height });
        }
        
        media.push({ type: 'audio', quality: '192kbps MP3', bitrate: 192 });
    }
    
    if (media.length === 0) {
        media.push({ type: 'video', quality: 'Best Quality', height: 720 });
        media.push({ type: 'audio', quality: '192kbps MP3', bitrate: 192 });
    }
    
    return {
        title,
        thumbnail,
        duration,
        uploader,
        description,
        media,
        originalUrl: finalUrl,
        success: true
    };
}

async function downloadMedia(url, outputPath, options = {}) {
    const { type = 'video', height = null, bitrate = 192 } = options;
    
    let format;
    let extractAudio = false;
    
    if (type === 'audio' || type === 'mp3') {
        extractAudio = true;
    } else if (height && parseInt(height) > 0) {
        format = `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best`;
    } else {
        format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }
    
    await executeYtDlp(url, outputPath, {
        format,
        extractAudio,
        audioFormat: 'mp3',
        audioQuality: bitrate
    });
    
    return outputPath;
}

// API ENDPOINTS
app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    
    if (!imageUrl) {
        return res.status(400).json({ error: 'Image URL required' });
    }
    
    try {
        const protocol = imageUrl.startsWith('https') ? https : http;
        const request = protocol.get(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com',
                'Accept': 'image/webp,image/apng,image/*,*/*'
            }
        }, (response) => {
            const contentType = response.headers['content-type'] || mime.lookup(imageUrl) || 'image/jpeg';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            response.pipe(res);
        });
        
        request.on('error', (err) => {
            console.error('Proxy image error:', err);
            res.status(500).json({ error: 'Failed to load image' });
        });
        
        request.setTimeout(15000, () => {
            request.destroy();
            res.status(408).json({ error: 'Timeout' });
        });
        
    } catch (err) {
        console.error('Proxy image error:', err);
        res.status(500).json({ error: 'Failed to load image' });
    }
});

app.post('/api/download', async (req, res) => {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        const data = await retry(() => fetchMediaInfo(url), 2, 1000);
        res.json(data);
    } catch (err) {
        console.error('Error fetching media:', err);
        res.status(400).json({ error: err.message || 'Failed to fetch media info' });
    }
});

app.get('/api/download-file', async (req, res) => {
    const { url, type, title, height, bitrate } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    let finalUrl = url;
    if (url.includes('pin.it')) {
        try {
            finalUrl = await resolvePinterestUrl(url);
            console.log(`📌 Final URL for download: ${finalUrl}`);
        } catch (err) {
            console.log('⚠️ Could not resolve Pinterest URL');
        }
    }
    
    const filename = title ? sanitizeFilename(title) : 'download';
    const ext = (type === 'mp3' || type === 'audio') ? 'mp3' : (type === 'image' ? 'jpg' : 'mp4');
    const tempFile = path.join(config.tempDir, `${uuidv4()}_${filename}.${ext}`);
    
    try {
        await downloadMedia(finalUrl, tempFile, { type, height, bitrate });
        
        const stats = await fs.stat(tempFile);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }
        
        const contentType = type === 'mp3' ? 'audio/mpeg' : (type === 'image' ? 'image/jpeg' : 'video/mp4');
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.${ext}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        const readStream = fs.createReadStream(tempFile);
        readStream.pipe(res);
        
        readStream.on('end', async () => {
            console.log(`✅ Download complete: ${filename}.${ext} (${stats.size} bytes)`);
            setTimeout(() => fs.remove(tempFile).catch(() => {}), 30000);
        });
        
        readStream.on('error', async (err) => {
            console.error('Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed' });
            }
            await fs.remove(tempFile).catch(() => {});
        });
        
    } catch (err) {
        console.error('Download error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: `Download failed: ${err.message}` });
        }
        await fs.remove(tempFile).catch(() => {});
    }
});

app.get('/api/stream', async (req, res) => {
    const { url, type } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    let finalUrl = url;
    if (url.includes('pin.it')) {
        try {
            finalUrl = await resolvePinterestUrl(url);
        } catch (err) {
            console.log('⚠️ Could not resolve Pinterest URL');
        }
    }
    
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const tempFile = path.join(config.tempDir, `preview_${uuidv4()}.${ext}`);
    
    try {
        if (type === 'audio') {
            await executeYtDlp(finalUrl, tempFile, { extractAudio: true, audioQuality: 128 });
        } else {
            await executeYtDlp(finalUrl, tempFile, { format: 'best[height<=480][ext=mp4]/best[ext=mp4]/best' });
        }
        
        const stats = await fs.stat(tempFile);
        if (stats.size === 0) {
            throw new Error('Preview file is empty');
        }
        
        const contentType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        
        const readStream = fs.createReadStream(tempFile);
        readStream.pipe(res);
        
        readStream.on('end', () => {
            setTimeout(() => fs.remove(tempFile).catch(() => {}), 30000);
        });
        
    } catch (err) {
        console.error('Preview error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Preview failed' });
        }
        await fs.remove(tempFile).catch(() => {});
    }
});

app.get('/api/proxy', async (req, res) => {
    const fileUrl = req.query.url;
    let filename = req.query.filename || 'download';
    
    if (!fileUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    try {
        const protocol = fileUrl.startsWith('https') ? https : http;
        const request = protocol.get(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*'
            }
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                return res.redirect(response.headers.location);
            }
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP ${response.statusCode}`);
            }
            
            const safeFilename = sanitizeFilename(filename);
            const contentType = response.headers['content-type'] || mime.lookup(fileUrl) || 'application/octet-stream';
            
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
            res.setHeader('Content-Type', contentType);
            response.pipe(res);
        });
        
        request.on('error', (err) => {
            throw err;
        });
        
        request.setTimeout(60000, () => {
            request.destroy();
            throw new Error('Timeout');
        });
        
    } catch (err) {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy failed' });
        }
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cookiesExists: checkCookies(),
        tempDir: config.tempDir
    });
});

app.get('/api/test', (req, res) => {
    res.json({
        status: 'Server running',
        timestamp: new Date().toISOString(),
        version: '3.0.0'
    });
});



async function startServer() {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║     🚀 Production-Stable DownX Server v3.0 Starting...      ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            exec('yt-dlp --version', (err, stdout) => {
                if (err) reject(err);
                else resolve({ stdout });
            });
        });
        console.log(`✅ yt-dlp version: ${stdout.trim()}`);
    } catch (err) {
        console.error('❌ yt-dlp is not installed!');
        console.log('\n📦 Install yt-dlp: pip install yt-dlp\n');
        process.exit(1);
    }
    
    try {
        const { stdout } = await new Promise((resolve, reject) => {
            exec('ffmpeg -version', (err, stdout) => {
                if (err) reject(err);
                else resolve({ stdout });
            });
        });
        console.log(`✅ ffmpeg: ${stdout.split('\n')[0]}`);
    } catch (err) {
        console.log('⚠️  ffmpeg not found - MP3 extraction may not work\n');
    }
    
    if (checkCookies()) {
        console.log('✅ cookies.txt found');
    } else {
        console.log('⚠️  cookies.txt not found!');
    }
    
    app.listen(PORT, () => {
        console.log(`\n✅ Server: http://localhost:${PORT}`);
        console.log(`📱 Open in browser\n`);
        console.log(`🎯 Supported Platforms:`);
        console.log(`   ✓ YouTube, Instagram, Facebook, TikTok`);
        console.log(`   ✓ Twitter/X, Pinterest (short URLs), Threads`);
        console.log(`   ✓ Vimeo and 20+ more platforms\n`);
    });
}

startServer();