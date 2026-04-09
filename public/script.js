document.addEventListener('DOMContentLoaded', function() {
    console.log('DownX Ready - Enhanced Version with Direct Download');
    
    const API_URL = '/api/download';
    const DOWNLOAD_URL = '/api/download-file';
    const STREAM_URL = '/api/stream';
    const MAX_HISTORY = 20;
    
    // DOM Elements
    const urlInput = document.getElementById('urlInput');
    const fetchBtn = document.getElementById('fetchBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const heroSection = document.getElementById('heroSection');
    const resultsSection = document.getElementById('resultsSection');
    const historySection = document.getElementById('historySection');
    const thumbnailImg = document.getElementById('thumbnail');
    const durationBadge = document.getElementById('duration');
    const qualityBadge = document.getElementById('qualityBadge');
    const titleEl = document.getElementById('title');
    const uploaderEl = document.getElementById('uploader');
    const descriptionEl = document.getElementById('description');
    const previewPlayer = document.getElementById('previewPlayer');
    const previewAudio = document.getElementById('previewAudio');
    const videoSource = document.getElementById('videoSource');
    const qualitySelect = document.getElementById('qualitySelect');
    const fileSizeDiv = document.getElementById('fileSize');
    const qualityInfo = document.getElementById('qualityInfo');
    const downloadVideoBtn = document.getElementById('downloadVideoBtn');
    const downloadMp3Btn = document.getElementById('downloadMp3Btn');
    const playPreviewBtn = document.getElementById('playPreviewBtn');
    const homeNavLink = document.getElementById('homeNavLink');
    const historyNavLink = document.getElementById('historyNavLink');
    const homeLogo = document.getElementById('homeLogo');
    const historyPageList = document.getElementById('historyPageList');
    const clearHistoryPageBtn = document.getElementById('clearHistoryPageBtn');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const toastDiv = document.getElementById('toast');
    const playerSection = document.querySelector('.player-section');
    
    // Mobile sidebar
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileSidebar = document.getElementById('mobileSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const sidebarHomeLink = document.getElementById('sidebarHomeLink');
    const sidebarHistoryLink = document.getElementById('sidebarHistoryLink');
    
    let currentMediaData = null;
    let currentSelectedFormat = null;
    let currentOriginalUrl = null;
    let currentVideoTitle = null;
    
    // Mobile sidebar functions
    function openSidebar() {
        mobileSidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    
    function closeSidebar() {
        mobileSidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
    if (sidebarHomeLink) sidebarHomeLink.addEventListener('click', () => { closeSidebar(); showHome(); });
    if (sidebarHistoryLink) sidebarHistoryLink.addEventListener('click', () => { closeSidebar(); showHistory(); });
    
    // Toast notification
    function showToast(message, type = 'error') {
        if (!toastDiv) return;
        toastDiv.className = 'toast';
        if (type === 'error') toastDiv.classList.add('error');
        if (type === 'success') toastDiv.classList.add('success');
        if (type === 'info') toastDiv.classList.add('info');
        const msgSpan = toastDiv.querySelector('.toast-message');
        if (msgSpan) msgSpan.innerText = message;
        toastDiv.style.display = 'block';
        setTimeout(() => {
            toastDiv.style.display = 'none';
            toastDiv.classList.remove('error', 'success', 'info');
        }, 4000);
    }
    
    function setLoading(loading) {
        if (loadingOverlay) {
            loadingOverlay.style.display = loading ? 'flex' : 'none';
        }
    }
    
    function sanitizeFilename(title) {
        return title.replace(/[\\/:*?"<>|]/g, '').trim().substring(0, 100);
    }
    
    function showHome() {
        if (heroSection) heroSection.style.display = 'flex';
        if (resultsSection) resultsSection.style.display = 'none';
        if (historySection) historySection.style.display = 'none';
        if (urlInput) urlInput.value = '';
        
        if (previewPlayer) {
            previewPlayer.pause();
            videoSource.src = '';
            previewPlayer.style.display = 'none';
            previewAudio.style.display = 'none';
            previewPlayer.load();
        }
        if (previewAudio) {
            previewAudio.pause();
            previewAudio.src = '';
        }
        if (playerSection) playerSection.classList.remove('active');
        
        currentMediaData = null;
        currentSelectedFormat = null;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    function showHistory() {
        if (heroSection) heroSection.style.display = 'none';
        if (resultsSection) resultsSection.style.display = 'none';
        if (historySection) historySection.style.display = 'block';
        renderHistoryPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    function closeHistory() { showHome(); }
    
    function renderHistoryPage() {
        if (!historyPageList) return;
        const history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
        historyPageList.innerHTML = '';
        
        if (history.length === 0) {
            historyPageList.innerHTML = '<div class="empty-history-page">No recent downloads. Paste a link to start.</div>';
            return;
        }
        
        history.forEach((item) => {
            const div = document.createElement('div');
            div.className = 'history-page-item';
            div.innerHTML = `
                <div class="history-item-info">
                    <div class="history-item-title">${item.title.length > 50 ? item.title.slice(0, 47) + '...' : item.title}</div>
                    <div class="history-item-url">${item.url.length > 60 ? item.url.slice(0, 57) + '...' : item.url}</div>
                </div>
                <div class="history-item-date">${new Date(item.timestamp).toLocaleDateString()}</div>
            `;
            div.onclick = () => {
                showHome();
                setTimeout(() => {
                    if (urlInput) urlInput.value = item.url;
                    handleFetch();
                }, 100);
            };
            historyPageList.appendChild(div);
        });
    }
    
    function clearHistory() {
        localStorage.removeItem('downloadHistory');
        renderHistoryPage();
        showToast('History cleared!', 'success');
    }
    
    // Fetch media info
    async function fetchMedia(url) {
        setLoading(true);
        
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to fetch');
            }
            
            const data = await response.json();
            console.log('Media data:', data);
            return data;
        } catch (err) {
            console.error('Fetch error:', err);
            showToast(err.message || 'Failed to fetch media. Check URL.', 'error');
            return null;
        } finally {
            setLoading(false);
        }
    }
    
    // Populate quality dropdown with video, audio, and image support
    function populateDropdown(mediaList) {
        if (!qualitySelect) return;
        
        qualitySelect.innerHTML = '<option value="">Select quality / format</option>';
        
        if (!mediaList || mediaList.length === 0) {
            qualitySelect.disabled = true;
            downloadVideoBtn.disabled = true;
            downloadMp3Btn.disabled = true;
            playPreviewBtn.disabled = true;
            return;
        }
        
        const videos = mediaList.filter(m => m.type === 'video');
        const audios = mediaList.filter(m => m.type === 'audio');
        const images = mediaList.filter(m => m.type === 'image');
        
        // Add video options
        if (videos.length > 0) {
            const videoGroup = document.createElement('optgroup');
            videoGroup.label = '📹 Video Formats';
            videos.forEach((item) => {
                const option = document.createElement('option');
                option.value = mediaList.indexOf(item);
                option.textContent = item.quality;
                videoGroup.appendChild(option);
            });
            qualitySelect.appendChild(videoGroup);
        }
        
        // Add audio options
        if (audios.length > 0) {
            const audioGroup = document.createElement('optgroup');
            audioGroup.label = '🎵 Audio Formats (MP3)';
            audios.forEach((item) => {
                const option = document.createElement('option');
                option.value = mediaList.indexOf(item);
                option.textContent = item.quality;
                audioGroup.appendChild(option);
            });
            qualitySelect.appendChild(audioGroup);
        }
        
        // Add image options for Pinterest/Instagram/Threads
        if (images.length > 0) {
            const imageGroup = document.createElement('optgroup');
            imageGroup.label = '🖼️ Images';
            images.forEach((item) => {
                const option = document.createElement('option');
                option.value = mediaList.indexOf(item);
                option.textContent = item.quality;
                imageGroup.appendChild(option);
            });
            qualitySelect.appendChild(imageGroup);
        }
        
        qualitySelect.disabled = false;
        downloadVideoBtn.disabled = true;
        downloadMp3Btn.disabled = true;
        playPreviewBtn.disabled = true;
        
        currentSelectedFormat = null;
        
        qualitySelect.onchange = (e) => {
            const selectedValue = e.target.value;
            
            if (selectedValue === '' || selectedValue === null) {
                currentSelectedFormat = null;
                downloadVideoBtn.disabled = true;
                downloadMp3Btn.disabled = true;
                playPreviewBtn.disabled = true;
                fileSizeDiv.innerText = '';
                qualityInfo.innerText = '';
                return;
            }
            
            const idx = parseInt(selectedValue);
            
            if (currentMediaData && currentMediaData[idx]) {
                currentSelectedFormat = currentMediaData[idx];
                
                if (currentSelectedFormat.type === 'video') {
                    qualityInfo.innerText = `✨ ${currentSelectedFormat.quality} video ready`;
                    downloadVideoBtn.disabled = false;
                    downloadMp3Btn.disabled = true;
                    playPreviewBtn.disabled = false;
                    // Reset download video button text
                    downloadVideoBtn.innerHTML = '<i class="fas fa-video"></i> Download HD Video';
                } else if (currentSelectedFormat.type === 'audio') {
                    qualityInfo.innerText = `🎵 ${currentSelectedFormat.quality} audio ready`;
                    downloadVideoBtn.disabled = true;
                    downloadMp3Btn.disabled = false;
                    playPreviewBtn.disabled = false;
                    // Reset download MP3 button text
                    downloadMp3Btn.innerHTML = '<i class="fas fa-music"></i> Download MP3 Audio';
                } else if (currentSelectedFormat.type === 'image') {
                    qualityInfo.innerText = `🖼️ ${currentSelectedFormat.quality} image ready`;
                    downloadVideoBtn.disabled = false;
                    downloadMp3Btn.disabled = true;
                    playPreviewBtn.disabled = true;
                    // Change download button text for image
                    downloadVideoBtn.innerHTML = '<i class="fas fa-image"></i> Download Image';
                }
                fileSizeDiv.innerText = '';
            }
        };
    }
    
    // Play preview
    function playPreview() {
        if (!currentSelectedFormat) {
            showToast('Please select a format first', 'error');
            return;
        }
        
        if (currentSelectedFormat.type === 'image') {
            showToast('Images cannot be previewed, click download to save', 'info');
            return;
        }
        
        if (!currentOriginalUrl) {
            showToast('No media URL available', 'error');
            return;
        }
        
        const type = currentSelectedFormat.type === 'video' ? 'video' : 'audio';
        const streamUrl = `${STREAM_URL}?url=${encodeURIComponent(currentOriginalUrl)}&type=${type}`;
        
        if (previewPlayer) {
            previewPlayer.pause();
            previewPlayer.style.display = 'none';
        }
        if (previewAudio) {
            previewAudio.pause();
            previewAudio.style.display = 'none';
        }
        
        showToast(`Loading ${type} preview...`, 'success');
        
        if (type === 'video') {
            videoSource.src = streamUrl;
            previewPlayer.load();
            previewPlayer.style.display = 'block';
            if (playerSection) playerSection.classList.add('active');
            previewPlayer.play().catch(e => {
                console.log('Auto-play blocked:', e);
                showToast('Click play on the video player', 'success');
            });
        } else {
            previewAudio.src = streamUrl;
            previewAudio.load();
            previewAudio.style.display = 'block';
            if (playerSection) playerSection.classList.add('active');
            previewAudio.play().catch(e => {
                console.log('Auto-play blocked:', e);
                showToast('Click play on the audio player', 'success');
            });
        }
    }
    
    // FIXED: Download function with DIRECT DOWNLOAD (no blob/fetch)
    async function downloadMedia(formatObj, type) {
        console.log('Download clicked - Type:', type);
        console.log('Format object:', formatObj);
        console.log('Original URL:', currentOriginalUrl);
        
        if (!formatObj) {
            showToast('Please select a format first', 'error');
            return;
        }
        
        // Handle image download - DIRECT DOWNLOAD (no blob)
        if (formatObj.type === 'image') {
            const imageUrl = formatObj.url || currentOriginalUrl;
            if (!imageUrl) {
                showToast('Image URL not available', 'error');
                return;
            }
            
            try {
                const title = sanitizeFilename(currentVideoTitle || 'image');
                showToast('Downloading image...', 'success');
                
                // DIRECT DOWNLOAD - no fetch/blob
                const a = document.createElement('a');
                a.href = `/api/proxy?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(title)}.jpg`;
                a.setAttribute('download', `${title}.jpg`);
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                showToast('✅ Image download started', 'success');
                return;
            } catch (err) {
                console.error('Image download error:', err);
                showToast('Failed to download image', 'error');
                return;
            }
        }
        
        if (!currentOriginalUrl) {
            showToast('No media URL available', 'error');
            return;
        }
        
        let title = currentVideoTitle || 'media';
        title = sanitizeFilename(title);
        const downloadType = type === 'video' ? 'video' : 'mp3';
        const height = formatObj.height || '';
        const bitrate = formatObj.bitrate || 192;
        
        const downloadUrl = `${DOWNLOAD_URL}?url=${encodeURIComponent(currentOriginalUrl)}&type=${downloadType}&title=${encodeURIComponent(title)}&height=${height}&bitrate=${bitrate}`;
        
        console.log('Download URL:', downloadUrl);
        
        try {
            const btn = type === 'video' ? downloadVideoBtn : downloadMp3Btn;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;
            
            showToast(`Processing ${title}.${downloadType === 'mp3' ? 'mp3' : 'mp4'}...`, 'success');
            
            // FIXED: DIRECT DOWNLOAD - no fetch/blob, browser handles directly
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.setAttribute('download', `${title}.${downloadType === 'mp3' ? 'mp3' : 'mp4'}`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            showToast(`✅ Download started: ${title}.${downloadType === 'mp3' ? 'mp3' : 'mp4'}`, 'success');
            
            // Save to history
            try {
                let history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
                const newEntry = { 
                    url: urlInput.value, 
                    title: title, 
                    timestamp: Date.now(),
                    type: type
                };
                history = [newEntry, ...history.filter(h => h.url !== urlInput.value)].slice(0, MAX_HISTORY);
                localStorage.setItem('downloadHistory', JSON.stringify(history));
                renderHistoryPage();
            } catch(e) {}
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }, 2000);
            
        } catch (err) {
            console.error('Download error:', err);
            showToast(`Download failed: ${err.message}`, 'error');
            const btn = type === 'video' ? downloadVideoBtn : downloadMp3Btn;
            btn.innerHTML = type === 'video' ? '<i class="fas fa-video"></i> Download HD Video' : '<i class="fas fa-music"></i> Download MP3 Audio';
            btn.disabled = false;
        }
    }
    
    // Main fetch handler
    async function handleFetch() {
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
            showToast('Please enter a URL', 'error');
            return;
        }
        
        const data = await fetchMedia(url);
        if (!data) return;
        
        currentMediaData = data.media;
        currentOriginalUrl = data.originalUrl;
        currentVideoTitle = data.title;
        
        console.log('Media data loaded:', {
            mediaCount: data.media.length,
            originalUrl: currentOriginalUrl,
            title: currentVideoTitle,
            hasImages: data.media.some(m => m.type === 'image')
        });
        
        // Update UI
        if (titleEl) titleEl.innerText = data.title || 'Untitled';
        if (uploaderEl) uploaderEl.innerText = data.uploader || 'Various';
        if (descriptionEl) descriptionEl.innerText = data.description || 'No description';
        
        // Better thumbnail handling with proxy for Instagram
        if (thumbnailImg && data.thumbnail) {
            thumbnailImg.src = data.thumbnail;
            thumbnailImg.onerror = function() {
                console.log('Thumbnail failed to load, using placeholder');
                thumbnailImg.src = 'https://via.placeholder.com/300x200?text=No+Thumbnail';
            };
        } else if (thumbnailImg) {
            thumbnailImg.src = 'https://via.placeholder.com/300x200?text=No+Thumbnail';
        }
        
        if (durationBadge && data.duration) durationBadge.innerText = data.duration;
        
        // Check for HD videos
        const hasHD = data.media.some(m => m.type === 'video' && m.height && m.height >= 720);
        if (qualityBadge) {
            qualityBadge.textContent = hasHD ? '🎬 HD Available' : (data.media.some(m => m.type === 'image') ? '🖼️ Image Available' : '📹 Video Available');
            qualityBadge.style.background = hasHD ? 'var(--gradient)' : '#666';
        }
        
        // Reset player
        if (previewPlayer) {
            previewPlayer.pause();
            previewPlayer.style.display = 'none';
            videoSource.src = '';
        }
        if (previewAudio) {
            previewAudio.pause();
            previewAudio.style.display = 'none';
            previewAudio.src = '';
        }
        if (playerSection) playerSection.classList.remove('active');
        
        populateDropdown(data.media);
        
        // Show results section
        if (heroSection) heroSection.style.display = 'none';
        if (resultsSection) resultsSection.style.display = 'block';
        if (historySection) historySection.style.display = 'none';
        
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        const mediaTypes = [];
        if (data.media.some(m => m.type === 'video')) mediaTypes.push('video');
        if (data.media.some(m => m.type === 'audio')) mediaTypes.push('audio');
        if (data.media.some(m => m.type === 'image')) mediaTypes.push('image');
        
        showToast(`✅ Found ${data.media.length} formats! (${mediaTypes.join(', ')})`, 'success');
        
        // Save to history
        try {
            let history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
            const newEntry = { url: url, title: data.title, timestamp: Date.now() };
            history = [newEntry, ...history.filter(h => h.url !== url)].slice(0, MAX_HISTORY);
            localStorage.setItem('downloadHistory', JSON.stringify(history));
            renderHistoryPage();
        } catch(e) {}
    }
    
    // Event listeners
    if (fetchBtn) fetchBtn.addEventListener('click', (e) => { e.preventDefault(); handleFetch(); });
    if (downloadVideoBtn) downloadVideoBtn.addEventListener('click', () => {
        if (currentSelectedFormat && currentSelectedFormat.type === 'image') {
            downloadMedia(currentSelectedFormat, 'image');
        } else {
            downloadMedia(currentSelectedFormat, 'video');
        }
    });
    if (downloadMp3Btn) downloadMp3Btn.addEventListener('click', () => downloadMedia(currentSelectedFormat, 'audio'));
    if (playPreviewBtn) playPreviewBtn.addEventListener('click', playPreview);
    if (homeNavLink) homeNavLink.addEventListener('click', (e) => { e.preventDefault(); showHome(); });
    if (historyNavLink) historyNavLink.addEventListener('click', (e) => { e.preventDefault(); showHistory(); });
    if (homeLogo) homeLogo.addEventListener('click', showHome);
    if (clearHistoryPageBtn) clearHistoryPageBtn.addEventListener('click', clearHistory);
    if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistory);
    if (urlInput) urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleFetch(); });
    
    renderHistoryPage();
    showHome();
});

window.showToast = function(message, type) {
    const toastDiv = document.getElementById('toast');
    if (!toastDiv) return;
    toastDiv.className = 'toast';
    if (type === 'error') toastDiv.classList.add('error');
    if (type === 'success') toastDiv.classList.add('success');
    if (type === 'info') toastDiv.classList.add('info');
    const msgSpan = toastDiv.querySelector('.toast-message');
    if (msgSpan) msgSpan.innerText = message;
    toastDiv.style.display = 'block';
    setTimeout(() => {
        toastDiv.style.display = 'none';
        toastDiv.classList.remove('error', 'success', 'info');
    }, 4000);
};