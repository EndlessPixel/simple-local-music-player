// ---- 主题管理 ------------------------------------------------------------
const THEME_KEY = 'theme-preference';

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || getSystemTheme());
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(getSystemTheme());
    });
}

// ---- 性能工具 ------------------------------------------------------------
function throttle(fn, delay) {
    let last = 0;
    return function (...args) {
        const now = Date.now();
        if (now - last >= delay) { last = now; fn.apply(this, args); }
    };
}

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ---- 常量 ----------------------------------------------------------------
const AUTO_REFRESH_INTERVAL = 60;
const state = {
    songs: {},
    flatSongs: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 0,
    collapsedFolders: new Set(),
    refreshCountdown: AUTO_REFRESH_INTERVAL,
    refreshInterval: null,
    autoRefreshEnabled: true,
    pendingAutoPlay: false,
    pendingListener: null,
    searchHistory: [],
    lastSearchTerm: ''
};
const SEARCH_HISTORY_KEY = 'musicSearchHistory';
const MAX_SEARCH_HISTORY = 20;
const audio = document.getElementById('audioPlayer');
const songList = document.getElementById('songList');
const songCount = document.getElementById('songCount');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const searchHistoryEl = document.getElementById('searchHistory');
const searchHistoryList = document.getElementById('searchHistoryList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const playModeBtn = document.getElementById('playModeBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const currentTitleEl = document.getElementById('currentTitle');
const currentArtistEl = document.getElementById('currentArtist');
const currentPathEl = document.getElementById('currentPath');
const albumArt = document.getElementById('albumArt');
const visualizerCanvas = document.getElementById('visualizer');
const speedBtn = document.getElementById('speedBtn');
const speedMenu = document.getElementById('speedMenu');
const speedLabel = speedBtn.querySelector('.speed-label');
const volumeSlider = document.getElementById('volumeSlider');

// ---------- 工具函数 ----------
function showToast(message) {
    let toast = document.querySelector('.toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------- 播放错误处理增强 ----------
function handlePlayError(err, context = '播放') {
    console.warn(`[${context}] 播放失败:`, err);
    let message = '播放失败，请重试';
    if (err.name === 'NotAllowedError') {
        message = '浏览器阻止了自动播放，请点击页面后手动点击播放按钮';
    } else if (err.name === 'NotFoundError') {
        message = '歌曲文件不存在，请检查文件路径';
    } else if (err.name === 'NotSupportedError') {
        message = '音频格式不支持，请尝试其他文件';
    } else if (err.name === 'AbortError') {
        message = '播放被中断，请稍后重试';
    } else if (err.message && err.message.includes('network')) {
        message = '网络错误，请检查连接';
    } else {
        message = `播放失败：${err.message || '未知错误'}`;
    }
    showToast(message);
    return message;
}

// 安全播放（仅负责调用，不处理错误，由调用者处理）
function safePlay() {
    try {
        const p = audio.play();
        if (p && typeof p.then === 'function') {
            return p;
        }
        return Promise.resolve();
    } catch (e) {
        return Promise.reject(e);
    }
}

// ---------- 音频事件绑定 ----------
function handleAudioTimeUpdate() {
    if (!audio.duration || isNaN(audio.duration) || audio.duration === Infinity) {
        progressFill.style.width = '0%';
        currentTimeEl.textContent = formatTime(audio.currentTime);
        return;
    }
    const percent = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    currentTimeEl.textContent = formatTime(audio.currentTime);
}

function handleAudioLoadedMetadata() {
    totalTimeEl.textContent = formatTime(audio.duration);
}

function handleAudioEnded() {
    if (state.repeatMode === 1) {
        audio.currentTime = 0;
        safePlay().catch(err => {
            handlePlayError(err, '单曲循环重播');
            state.isPlaying = false;
            updatePlayButton();
            albumArt.classList.remove('playing');
        });
    } else if (state.isShuffle || state.currentIndex < state.flatSongs.length - 1) {
        playSong(getNextIndex(), true);
    } else {
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
    }
}

function handleAudioPlay() {
    state.isPlaying = true;
    updatePlayButton();
    albumArt.classList.add('playing');
    startVisualizer();
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
    }
}

function handleAudioPause() {
    state.isPlaying = false;
    updatePlayButton();
    albumArt.classList.remove('playing');
    stopVisualizer();
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
    }
}

// 音频加载错误监听
function handleAudioError() {
    const error = audio.error;
    if (error) {
        let msg = '音频加载失败';
        switch (error.code) {
            case MediaError.MEDIA_ERR_ABORTED: msg = '加载被中止'; break;
            case MediaError.MEDIA_ERR_NETWORK: msg = '网络错误，请检查连接'; break;
            case MediaError.MEDIA_ERR_DECODE: msg = '音频解码失败，文件可能损坏'; break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = '音频格式不被支持'; break;
            default: msg = `未知错误 (${error.code})`;
        }
        showToast(msg);
    }
    // 将播放状态置为 false
    state.isPlaying = false;
    updatePlayButton();
    albumArt.classList.remove('playing');
}

audio.addEventListener('timeupdate', throttle(handleAudioTimeUpdate, 60));
audio.addEventListener('loadedmetadata', handleAudioLoadedMetadata);
audio.addEventListener('ended', handleAudioEnded);
audio.addEventListener('pause', handleAudioPause);
audio.addEventListener('play', handleAudioPlay);
audio.addEventListener('error', handleAudioError);

// ---------- 核心播放函数 ----------
function playSong(index, autoPlay = true) {
    if (index < 0 || index >= state.flatSongs.length) {
        showToast('歌曲索引无效');
        return;
    }

    state.currentIndex = index;
    const { folder, song } = state.flatSongs[index];
    let path;
    if (!folder || folder === '.') {
        path = `/${encodeURIComponent(song)}`;
    } else {
        const encodedFolder = folder.split('/').map(encodeURIComponent).join('/');
        path = `/${encodedFolder}/${encodeURIComponent(song)}`;
    }

    // 先暂停，清除旧状态
    audio.pause();
    audio.src = path;
    audio.load(); // 显式加载，触发 error 事件如果文件有问题

    // 更新 UI
    loadCover(folder, song);
    updateActiveItem({ folder, song });
    scrollToFolder(folder);
    const songTitle = song.replace(/\.[^.]+$/, '');
    currentTitleEl.textContent = songTitle;
    currentTitleEl.title = songTitle;
    currentPathEl.textContent = folder === '.' ? song : `${folder}/${song}`;
    currentPathEl.title = currentPathEl.textContent;
    // 更新 Media Session 元数据
    mediaSessionMeta.title = songTitle;
    mediaSessionMeta.artist = '';
    updateMediaSession();
    loadMeta(folder, song);

    if (autoPlay) {
        safePlay().then(() => {
            state.isPlaying = true;
            updatePlayButton();
            albumArt.classList.add('playing');
        }).catch(err => {
            state.isPlaying = false;
            updatePlayButton();
            albumArt.classList.remove('playing');
            handlePlayError(err, '自动播放');
        });
    } else {
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
    }
}

// ---------- 获取上下首索引 ----------
function getNextIndex() {
    if (state.isShuffle) {
        let next;
        do {
            next = Math.floor(Math.random() * state.flatSongs.length);
        } while (next === state.currentIndex && state.flatSongs.length > 1);
        return next;
    }
    return (state.currentIndex + 1) % state.flatSongs.length;
}

function getPrevIndex() {
    if (state.isShuffle) {
        let prev;
        do {
            prev = Math.floor(Math.random() * state.flatSongs.length);
        } while (prev === state.currentIndex && state.flatSongs.length > 1);
        return prev;
    }
    return (state.currentIndex - 1 + state.flatSongs.length) % state.flatSongs.length;
}

// ---------- UI 更新函数 ----------
function updatePlayButton() {
    const iconPlay = playBtn.querySelector('.icon-play');
    const iconPause = playBtn.querySelector('.icon-pause');
    iconPlay.style.display = state.isPlaying ? 'none' : 'block';
    iconPause.style.display = state.isPlaying ? 'block' : 'none';
}

function updateVolumeIcon(volume) {
    const high = document.querySelector('.icon-volume-high');
    const low = document.querySelector('.icon-volume-low');
    const mute = document.querySelector('.icon-volume-mute');
    high.style.display = volume > 50 ? 'block' : 'none';
    low.style.display = volume > 0 && volume <= 50 ? 'block' : 'none';
    mute.style.display = volume === 0 ? 'block' : 'none';
}

function updatePlayModeButton() {
    const iconRepeat = playModeBtn.querySelector('.icon-repeat');
    const badge = playModeBtn.querySelector('.repeat-one-badge');
    const iconShuffle = playModeBtn.querySelector('.icon-shuffle');

    if (state.isShuffle) {
        iconRepeat.style.display = 'none';
        badge.style.display = 'none';
        iconShuffle.style.display = 'block';
        playModeBtn.classList.add('active');
        playModeBtn.title = '随机播放';
    } else if (state.repeatMode === 1) {
        iconRepeat.style.display = 'block';
        badge.style.display = 'flex';
        iconShuffle.style.display = 'none';
        playModeBtn.classList.add('active');
        playModeBtn.title = '单曲循环';
    } else {
        iconRepeat.style.display = 'block';
        badge.style.display = 'none';
        iconShuffle.style.display = 'none';
        playModeBtn.classList.remove('active');
        playModeBtn.title = '列表循环';
    }
}

function updateActiveItem(currentSong) {
    if (!currentSong || state.flatSongs.length === 0) return;
    let newIndex = -1;
    for (let i = 0; i < state.flatSongs.length; i++) {
        if (state.flatSongs[i].folder === currentSong.folder &&
            state.flatSongs[i].song === currentSong.song) {
            newIndex = i;
            break;
        }
    }
    if (newIndex === -1) return;
    state.currentIndex = newIndex;

    document.querySelectorAll('.song-item').forEach(el => el.classList.remove('active'));
    const allItems = document.querySelectorAll('.song-item');
    for (const item of allItems) {
        if (item.dataset.folder === currentSong.folder && item.dataset.song === currentSong.song) {
            item.classList.add('active');
            break;
        }
    }
}

function scrollToFolder(folder) {
    const folderGroups = songList.querySelectorAll('.folder-group');
    let targetGroup = null;
    folderGroups.forEach(group => {
        const header = group.querySelector('.folder-header');
        if (header && header.dataset.folder === folder) {
            targetGroup = group;
        }
    });
    if (!targetGroup) return;
    if (targetGroup.classList.contains('collapsed')) {
        state.collapsedFolders.delete(folder);
        localStorage.setItem('collapsedFolders', JSON.stringify([...state.collapsedFolders]));
        targetGroup.classList.remove('collapsed');
        const songsContainer = targetGroup.querySelector('.folder-songs');
        if (songsContainer) songsContainer.classList.remove('collapsed');
    }
    const containerRect = songList.getBoundingClientRect();
    const groupRect = targetGroup.getBoundingClientRect();
    if (groupRect.top < containerRect.top || groupRect.top > containerRect.top + 100) {
        songList.scrollTo({
            top: targetGroup.offsetTop - 10,
            behavior: 'smooth'
        });
    }
}

// ---------- 封面 & 元数据 ----------
let currentCoverUrl = null;
function clearCoverUrl() {
    if (currentCoverUrl) {
        URL.revokeObjectURL(currentCoverUrl);
        currentCoverUrl = null;
    }
}

async function loadCover(folder, song) {
    clearCoverUrl();
    const params = new URLSearchParams();
    if (folder !== '.') params.set('folder', folder);
    params.set('song', song);
    try {
        const res = await fetch(`/api/cover?${params.toString()}`);
        if (res.ok) {
            const blob = await res.blob();
            currentCoverUrl = URL.createObjectURL(blob);
            albumArt.innerHTML = `<img src="${currentCoverUrl}" alt="封面" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">`;
            return;
        }
    } catch (err) {
        console.error('加载封面失败:', err);
    }
    albumArt.innerHTML = '<ion-icon name="musical-notes"></ion-icon>';
}

async function loadMeta(folder, song) {
    const params = new URLSearchParams();
    if (folder !== '.') params.set('folder', folder);
    params.set('song', song);
    try {
        const res = await fetch(`/api/meta?${params.toString()}`);
        if (res.ok) {
            const meta = await res.json();
            if (meta.artist) {
                currentArtistEl.textContent = meta.artist;
                currentArtistEl.title = meta.artist;
                mediaSessionMeta.artist = meta.artist;
            } else {
                currentArtistEl.textContent = '';
                currentArtistEl.title = '';
                mediaSessionMeta.artist = '';
            }
            if (meta.duration) totalTimeEl.textContent = formatTime(meta.duration);
            updateMediaSession();
        }
    } catch (err) {
        console.error('加载元数据失败:', err);
    }
}

// ---------- 播放控制事件 ----------
playBtn.addEventListener('click', () => {
    if (state.currentIndex === -1 && state.flatSongs.length > 0) {
        // 选择第一首并尝试播放
        playSong(0, true);
    } else if (state.isPlaying) {
        audio.pause();
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
    } else {
        // 当前暂停，尝试播放
        safePlay().then(() => {
            state.isPlaying = true;
            updatePlayButton();
            albumArt.classList.add('playing');
        }).catch(err => {
            state.isPlaying = false;
            updatePlayButton();
            albumArt.classList.remove('playing');
            handlePlayError(err, '手动播放');
        });
    }
});

prevBtn.addEventListener('click', () => {
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
    } else {
        playSong(getPrevIndex(), true);
    }
});

nextBtn.addEventListener('click', () => {
    playSong(getNextIndex(), true);
});

playModeBtn.addEventListener('click', () => {
    if (!state.isShuffle && state.repeatMode === 0) {
        state.repeatMode = 1;
    } else if (!state.isShuffle && state.repeatMode === 1) {
        state.repeatMode = 0;
        state.isShuffle = true;
    } else {
        state.repeatMode = 0;
        state.isShuffle = false;
    }
    updatePlayModeButton();
});

downloadBtn.addEventListener('click', () => {
    if (state.currentIndex === -1) return;
    const { folder, song } = state.flatSongs[state.currentIndex];
    let path;
    if (!folder || folder === '.') {
        path = `/${encodeURIComponent(song)}`;
    } else {
        const encodedFolder = folder.split('/').map(encodeURIComponent).join('/');
        path = `/${encodedFolder}/${encodeURIComponent(song)}`;
    }
    const link = document.createElement('a');
    link.href = path;
    link.download = song;
    link.click();
});

// ---------- 分享功能 ----------
const shareBtn = document.getElementById('shareBtn');
function buildShareUrl(folder, song) {
    const params = new URLSearchParams();
    params.set('song', song);
    if (folder && folder !== '.') params.set('folder', folder);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function applyShareLinkFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const song = params.get('song');
    if (!song) return;
    const folder = params.get('folder');
    const normalizedFolder = folder === '' ? '.' : (folder || '.');
    const index = state.flatSongs.findIndex(item => {
        if (folder) return item.song === song && item.folder === normalizedFolder;
        return item.song === song;
    });
    if (index === -1) {
        showToast('分享的歌曲不存在或已被删除');
        return;
    }
    playSong(index, false); // 只加载，不自动播放（让用户手动点击）
}

shareBtn.addEventListener('click', () => {
    if (state.currentIndex === -1) return;
    const { folder, song } = state.flatSongs[state.currentIndex];
    const shareUrl = buildShareUrl(folder, song);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('分享链接已复制到剪贴板');
        }).catch(() => {
            fallbackCopy(shareUrl);
        });
    } else {
        fallbackCopy(shareUrl);
    }
});

function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        showToast('分享链接已复制到剪贴板');
    } catch (e) {
        showToast('复制失败，请手动复制链接');
    }
    document.body.removeChild(input);
}

// ---------- 进度条 ----------
progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
});

// ---------- 音量 ----------
volumeSlider.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value);
    audio.volume = volume / 100;
    updateVolumeIcon(volume);
    localStorage.setItem('musicVolume', volume.toString());
});

// ---------- 搜索 ----------
searchInput.addEventListener('input', debounce((e) => {
    const value = e.target.value;
    renderSongList(state.songs, value);
    if (value.trim()) showSearchHistory();
    else hideSearchHistory();
}, 200));

searchInput.addEventListener('focus', () => {
    if (state.searchHistory.length > 0) showSearchHistory();
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const term = searchInput.value.trim();
        if (term) addSearchHistory(term);
        hideSearchHistory();
        searchInput.blur();
    } else if (e.key === 'Escape') {
        hideSearchHistory();
        searchInput.blur();
    }
});

// 搜索历史
function loadSearchHistory() {
    try {
        const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
        if (saved) state.searchHistory = JSON.parse(saved);
    } catch { state.searchHistory = []; }
    renderSearchHistory();
}
function saveSearchHistory() {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(state.searchHistory));
}
function addSearchHistory(term) {
    const trimmed = term.trim();
    if (!trimmed) return;
    if (state.lastSearchTerm === trimmed) return;
    state.lastSearchTerm = trimmed;
    state.searchHistory = state.searchHistory.filter(h => h.term !== trimmed);
    state.searchHistory.unshift({ term: trimmed, timestamp: Date.now() });
    if (state.searchHistory.length > MAX_SEARCH_HISTORY) {
        state.searchHistory = state.searchHistory.slice(0, MAX_SEARCH_HISTORY);
    }
    saveSearchHistory();
    renderSearchHistory(searchInput.value);
}
function deleteSearchHistory(term, event) {
    event.stopPropagation();
    const item = document.querySelector(`.search-history-item[data-term="${term}"]`);
    if (item) {
        item.classList.add('removing');
        setTimeout(() => {
            state.searchHistory = state.searchHistory.filter(h => h.term !== term);
            saveSearchHistory();
            renderSearchHistory(searchInput.value);
        }, 250);
    }
}
function clearAllSearchHistory() {
    if (state.searchHistory.length === 0) return;
    if (confirm('确定要清空所有搜索历史吗？')) {
        const items = searchHistoryList.querySelectorAll('.search-history-item');
        items.forEach((item, i) => {
            setTimeout(() => { item.classList.add('removing'); }, i * 50);
        });
        setTimeout(() => {
            state.searchHistory = [];
            saveSearchHistory();
            renderSearchHistory(searchInput.value);
        }, 250 + items.length * 50);
    }
}
function showSearchHistory() {
    renderSearchHistory(searchInput.value);
    searchHistoryEl.classList.add('show');
}
function hideSearchHistory() {
    searchHistoryEl.classList.remove('show');
}
function renderSearchHistory(filter = '') {
    const filtered = state.searchHistory.filter(item =>
        item.term.toLowerCase().includes(filter.toLowerCase())
    );
    if (filtered.length === 0) {
        searchHistoryList.innerHTML = `<div class="search-history-empty">${filter ? '没有匹配的搜索历史' : '暂无搜索历史'}</div>`;
        clearHistoryBtn.style.display = 'none';
        return;
    }
    clearHistoryBtn.style.display = 'block';
    searchHistoryList.innerHTML = filtered.map((item) => `
                <div class="search-history-item" data-term="${escapeHtml(item.term)}">
                    <ion-icon name="search" size="small"></ion-icon>
                    <span class="search-history-text">${escapeHtml(item.term)}</span>
                    <button class="search-history-delete" data-term="${escapeHtml(item.term)}" title="删除">
                        <ion-icon name="close" size="small"></ion-icon>
                    </button>
                </div>
            `).join('');
}
function handleSearchHistoryClick(e) {
    const item = e.target.closest('.search-history-item');
    if (item) {
        const deleteBtn = e.target.closest('.search-history-delete');
        if (deleteBtn) {
            deleteSearchHistory(deleteBtn.dataset.term, e);
        } else {
            const term = item.dataset.term;
            searchInput.value = term;
            renderSongList(state.songs, term);
            hideSearchHistory();
        }
    }
}
searchHistoryList.addEventListener('click', handleSearchHistoryClick);
clearHistoryBtn.addEventListener('click', clearAllSearchHistory);
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) hideSearchHistory();
});

// ---------- 自动刷新 ----------
function startAutoRefresh() {
    if (!state.autoRefreshEnabled || state.refreshInterval) return;
    state.refreshInterval = setInterval(() => {
        state.refreshCountdown--;
        if (state.refreshCountdown <= 0) {
            state.refreshCountdown = AUTO_REFRESH_INTERVAL;
            refreshSongList();
        }
        updateAutoRefreshUi();
    }, 1000);
    updateAutoRefreshUi();
}
function stopAutoRefresh() {
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
    }
    updateAutoRefreshUi();
}
function setAutoRefreshEnabled(enabled) {
    state.autoRefreshEnabled = enabled;
    localStorage.setItem('musicAutoRefreshEnabled', enabled ? '1' : '0');
    if (enabled) {
        if (!state.refreshInterval) {
            state.refreshCountdown = AUTO_REFRESH_INTERVAL;
            startAutoRefresh();
        }
    } else {
        stopAutoRefresh();
    }
}
function toggleAutoRefresh() {
    setAutoRefreshEnabled(!state.autoRefreshEnabled);
}
function updateAutoRefreshUi() {
    const autoRefreshEl = document.getElementById('autoRefresh');
    if (autoRefreshEl) {
        autoRefreshEl.textContent = state.autoRefreshEnabled ? `自动刷新: ${state.refreshCountdown}s` : '自动刷新: 已关闭';
    }
    const toggleBtn = document.getElementById('autoRefreshToggleBtn');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', state.autoRefreshEnabled);
        toggleBtn.setAttribute('aria-pressed', String(state.autoRefreshEnabled));
        toggleBtn.title = state.autoRefreshEnabled ? '关闭自动刷新' : '开启自动刷新';
    }
}
function areSongMapsEqual(oldMap, newMap) {
    const oldKeys = Object.keys(oldMap).sort();
    const newKeys = Object.keys(newMap).sort();
    if (oldKeys.length !== newKeys.length) return false;
    for (let i = 0; i < oldKeys.length; i++) {
        if (oldKeys[i] !== newKeys[i]) return false;
        const oldList = oldMap[oldKeys[i]];
        const newList = newMap[newKeys[i]];
        if (!Array.isArray(oldList) || !Array.isArray(newList)) return false;
        if (oldList.length !== newList.length) return false;
        for (let j = 0; j < oldList.length; j++) {
            if (oldList[j] !== newList[j]) return false;
        }
    }
    return true;
}
async function refreshSongList() {
    try {
        const res = await fetch('/api/songs');
        const newSongs = await res.json();
        if (areSongMapsEqual(state.songs, newSongs)) return;
        state.songs = newSongs;
        renderSongList(state.songs, searchInput.value);
        updateAutoRefreshUi();
    } catch (err) {
        console.error('刷新失败:', err);
    }
}
refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('loading');
    try {
        await refreshSongList();
        if (state.autoRefreshEnabled) {
            state.refreshCountdown = AUTO_REFRESH_INTERVAL;
            updateAutoRefreshUi();
        }
    } catch (err) {
        console.error('刷新失败:', err);
    } finally {
        refreshBtn.classList.remove('loading');
    }
});
document.addEventListener('click', (e) => {
    if (e.target.closest('#autoRefreshToggleBtn')) toggleAutoRefresh();
});

// ---------- 渲染歌曲列表 ----------
function renderSongList(songs, filter = '') {
    const currentScroll = songList.scrollTop;
    let currentSong = null;
    if (state.currentIndex >= 0 && state.flatSongs[state.currentIndex]) {
        const s = state.flatSongs[state.currentIndex];
        currentSong = { folder: s.folder, song: s.song };
    }
    songList.innerHTML = '';
    state.flatSongs = [];
    let totalSongs = 0;
    const folders = Object.keys(songs).sort((a, b) => {
        if (a === '.') return -1;
        if (b === '.') return 1;
        return a.localeCompare(b);
    });
    for (const folder of folders) {
        const songsInFolder = songs[folder].filter(name =>
            filter === '' || name.toLowerCase().includes(filter.toLowerCase())
        );
        if (songsInFolder.length === 0) continue;
        const isCollapsed = state.collapsedFolders.has(folder);
        const group = document.createElement('div');
        group.className = 'folder-group' + (isCollapsed ? ' collapsed' : '');
        const header = document.createElement('div');
        header.className = 'folder-header';
        header.dataset.folder = folder;
        header.innerHTML = `
                    <span class="folder-toggle"><ion-icon name="chevron-down" size="small"></ion-icon></span>
                    <span class="folder-icon"><ion-icon name="${folder === '.' ? 'folder-open' : 'folder'}" size="small"></ion-icon></span>
                    <span>${folder === '.' ? '根目录' : folder}</span>
                    <span style="margin-left: auto; opacity: 0.5;">${songsInFolder.length}</span>
                `;
        group.appendChild(header);
        const songsContainer = document.createElement('div');
        songsContainer.className = 'folder-songs' + (isCollapsed ? ' collapsed' : '');
        const sortedSongs = [...songsInFolder].sort();
        for (const song of sortedSongs) {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.dataset.index = state.flatSongs.length;
            item.dataset.folder = folder;
            item.dataset.song = song;
            const num = document.createElement('span');
            num.className = 'song-num';
            num.textContent = String(totalSongs + 1).padStart(2, '0');
            const playIcon = document.createElement('span');
            playIcon.className = 'song-play';
            playIcon.innerHTML = '<ion-icon name="play" size="small"></ion-icon>';
            const info = document.createElement('div');
            info.className = 'song-info';
            const title = document.createElement('div');
            title.className = 'song-title-text';
            title.textContent = song.replace(/\.[^.]+$/, '');
            const folderName = document.createElement('div');
            folderName.className = 'song-folder';
            folderName.textContent = folder === '.' ? '根目录' : folder;
            info.appendChild(title);
            info.appendChild(folderName);
            item.appendChild(num);
            item.appendChild(playIcon);
            item.appendChild(info);
            songsContainer.appendChild(item);
            state.flatSongs.push({ folder, song });
            totalSongs++;
        }
        group.appendChild(songsContainer);
        songList.appendChild(group);
    }
    songCount.innerHTML = `
                <span>共 ${totalSongs} 首歌曲</span>
                <span class="auto-refresh" id="autoRefresh">自动刷新: ${state.refreshCountdown}s</span>
                <button type="button" class="auto-refresh-toggle" id="autoRefreshToggleBtn" aria-pressed="false" title="开启自动刷新">自动刷新</button>
            `;
    if (totalSongs === 0) {
        songList.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon"><ion-icon name="musical-notes" size="large"></ion-icon></div>
                        <div class="empty-text">${filter ? '没有找到匹配的歌曲' : '将音乐文件放入 music 文件夹'}</div>
                    </div>
                `;
    }
    songList.scrollTop = currentScroll;
    updateActiveItem(currentSong);
}

// ---------- 自动播放尝试（页面加载时） ----------
function attemptAutoPlayOnLoad() {
    // 如果是分享链接，不自动播放
    if (new URLSearchParams(window.location.search).has('song')) return;
    if (state.currentIndex === -1) return;
    // 尝试播放第一首
    safePlay().then(() => {
        state.isPlaying = true;
        updatePlayButton();
        albumArt.classList.add('playing');
    }).catch(err => {
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
        // 静默处理，不提示（用户点击播放按钮时会再次尝试）
        console.log('自动播放被阻止（正常现象）:', err.name);
    });
}

// ---------- 速度控制 ----------
speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    speedMenu.classList.toggle('show');
});
speedMenu.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        const speed = parseFloat(e.target.dataset.speed);
        audio.playbackRate = speed;
        speedLabel.textContent = speed === 1.0 ? '1.0x' : speed + 'x';
        speedMenu.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });
        speedMenu.classList.remove('show');
    }
});
document.addEventListener('click', (e) => {
    if (!speedBtn.contains(e.target) && !speedMenu.contains(e.target)) {
        speedMenu.classList.remove('show');
    }
});

// ---------- 可视化 ----------
let audioCtx, analyser, dataArray, animationId, source;
function initVisualizer() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
    }
}
function startVisualizer() {
    if (!audioCtx) initVisualizer();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!document.hidden) drawVisualizer();
}
function stopVisualizer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}
// 标签页切换时暂停/恢复可视化，节省CPU
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopVisualizer();
    } else if (state.isPlaying) {
        startVisualizer();
    }
});
function drawVisualizer() {
    animationId = requestAnimationFrame(drawVisualizer);
    const canvas = visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, width, height);
    const barCount = 64;
    const barWidth = (width / barCount) * 0.8;
    const gap = (width / barCount) * 0.2;
    let x = 0;
    for (let i = 0; i < barCount; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.8;
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#007aff');
        gradient.addColorStop(1, '#1e90ff');
        ctx.fillStyle = gradient;
        const roundedHeight = barHeight > 0 ? Math.max(2, barHeight) : 0;
        const cornerRadius = Math.min(4, roundedHeight / 2);
        ctx.beginPath();
        ctx.roundRect(x, height - roundedHeight, barWidth, roundedHeight, [cornerRadius, cornerRadius, 0, 0]);
        ctx.fill();
        x += barWidth + gap;
    }
}

// ---------- 更新日志 & API 文档 ----------
function initChangelog() {
    const changelogBtn = document.getElementById('changelogBtn');
    const changelogPanel = document.getElementById('changelogPanel');
    const changelogOverlay = document.getElementById('changelogOverlay');
    const changelogClose = document.getElementById('changelogClose');
    const changelogContent = document.getElementById('changelogContent');
    const changelogPagination = document.getElementById('changelogPagination');

    changelogBtn.addEventListener('click', () => showChangelog());
    changelogClose.addEventListener('click', hideChangelog);
    changelogOverlay.addEventListener('click', hideChangelog);
    changelogPagination.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const page = parseInt(btn.dataset.page);
        if (!isNaN(page)) loadChangelog(page);
    });

    function showChangelog() {
        changelogPanel.classList.add('show');
        changelogOverlay.classList.add('show');
        currentPage = 1;
        loadChangelog(currentPage);
    }
    function hideChangelog() {
        changelogPanel.classList.remove('show');
        changelogOverlay.classList.remove('show');
    }
    let currentPage = 1;
    const PER_PAGE = 20;
    async function loadChangelog(page) {
        changelogContent.innerHTML = `<div class="loading-container"><div class="spinner"></div><span>正在加载...</span></div>`;
        try {
            const res = await fetch(`/api/commits?per_page=${PER_PAGE}&page=${page}`);
            const commits = await res.json();
            if (!Array.isArray(commits)) throw new Error('数据格式错误');
            if (commits.length === 0) {
                changelogContent.innerHTML = '<div class="changelog-empty">暂无更新日志</div>';
                changelogPagination.innerHTML = '';
                return;
            }
            changelogContent.innerHTML = commits.map(commit => {
                const date = new Date(commit.commit.author.date).toLocaleString('zh-CN');
                const author = commit.author || commit.commit.author;
                const avatar = author && author.avatar_url ? author.avatar_url : '';
                const authorName = author ? (author.login || author.name || '未知作者') : '未知作者';
                return `
                            <div class="changelog-item">
                                <div class="changelog-commit">${commit.sha.substring(0, 7)}</div>
                                <div class="changelog-message">${escapeHtml(commit.commit.message)}</div>
                                <div class="changelog-author">${avatar ? `<img src="${avatar}" alt="${authorName}">` : ''}<span>${authorName}</span></div>
                                <div class="changelog-date">${date}</div>
                            </div>
                        `;
            }).join('');
            const hasPrev = page > 1;
            const hasNext = commits.length === PER_PAGE;
            let html = '';
            if (hasPrev) html += `<button data-page="${page - 1}">上一页</button>`;
            html += `<button class="active" data-page="${page}">${page}</button>`;
            if (hasNext) html += `<button data-page="${page + 1}">下一页</button>`;
            changelogPagination.innerHTML = html;
        } catch (err) {
            changelogContent.innerHTML = '<div class="changelog-error">加载失败：' + err.message + '</div>';
            changelogPagination.innerHTML = '';
        }
    }
}

function initApiDoc() {
    const apiDocBtn = document.getElementById('apiDocBtn');
    const apiDocPanel = document.getElementById('apidocPanel');
    const apiDocOverlay = document.getElementById('apidocOverlay');
    const apiDocClose = document.getElementById('apidocClose');

    apiDocBtn.addEventListener('click', showApiDoc);
    apiDocClose.addEventListener('click', hideApiDoc);
    apiDocOverlay.addEventListener('click', hideApiDoc);

    function showApiDoc() {
        apiDocPanel.classList.add('show');
        apiDocOverlay.classList.add('show');
    }
    function hideApiDoc() {
        apiDocPanel.classList.remove('show');
        apiDocOverlay.classList.remove('show');
    }

    // 内联 API 文档（无需请求服务端）
    document.getElementById('apidocContent').innerHTML = buildApiDoc();
}

function buildApiDoc() {
    const endpoints = [
        {
            method: 'GET', path: '/api/songs',
            title: '获取音乐列表',
            desc: '扫描音乐目录，返回按文件夹分组的歌曲列表。',
            params: null,
            example: `{
    ".":       ["song.mp3", "demo.flac"],
    "古典":    ["月光.mp3", "四季.wav"],
    "Pop":     ["hit.mp3"]
}`,
            notes: '根目录的歌曲使用 <code>"."</code> 表示文件夹名。'
        },
        {
            method: 'GET', path: '/api/cover',
            title: '获取歌曲封面',
            desc: '查找并返回歌曲的内嵌封面图片。',
            params: [
                { name: 'folder', type: 'string', desc: '文件夹名称（需 URL 编码）' },
                { name: 'song', type: 'string', desc: '歌曲文件名（需 URL 编码）' }
            ],
            example: `/api/cover?folder=Pop&song=hit.mp3`,
            notes: '返回 <code>image/png</code> 或 <code>image/jpeg</code>；找不到则返回 <code>404</code>。'
        },
        {
            method: 'GET', path: '/api/meta',
            title: '获取歌曲元数据',
            desc: '读取音频文件的元数据，包括歌手、标题和时长。',
            params: [
                { name: 'folder', type: 'string', desc: '文件夹名称（需 URL 编码）' },
                { name: 'song', type: 'string', desc: '歌曲文件名（需 URL 编码）' }
            ],
            example: `// 响应示例
{
    "artist":   "周杰伦",
    "title":    "晴天",
    "duration": 269.3
}`,
            notes: '支持的格式：<code>MP3</code>、<code>FLAC</code>、<code>WAV</code>、<code>OGG</code>、<code>M4A</code>。未识别字段返回 <code>null</code>。'
        },
        {
            method: 'GET', path: '/api/commits',
            title: '获取更新日志',
            desc: '从 GitHub 仓库获取最近的提交记录，用于展示更新日志。',
            params: [
                { name: 'page', type: 'number', desc: '页码，默认 1' },
                { name: 'per_page', type: 'number', desc: '每页条数，默认 20' }
            ],
            example: `// 响应示例
[
    {
        "sha":         "abc123...",
        "commit":      { "message": "feat: 新增媒体键支持", "author": {...} },
        "html_url":    "https://github.com/...",
        "date":        "2026-07-24T10:00:00Z"
    }
]`,
            notes: '数据来自 <code>api.github.com</code>，可能受频率限制。'
        },
        {
            method: 'GET', path: '/{folder}/{song}',
            title: '获取音乐文件',
            desc: '直接提供音频文件流，支持 HTTP Range 请求以支持拖拽播放和断点续传。',
            params: [
                { name: 'folder', type: 'string', desc: '文件夹名称（可选，根目录歌曲可省略）' },
                { name: 'song', type: 'string', desc: '歌曲文件名（需 URL 编码）' }
            ],
            example: `/Pop/晴天.mp3
// 或根目录歌曲：
/song.mp3`,
            notes: '支持 <code>206 Partial Content</code> 响应（Range 请求），支持的格式：<code>.mp3</code>、<code>.flac</code>、<code>.wav</code>、<code>.ogg</code>、<code>.m4a</code>、<code>.aac</code>、<code>.wma</code>。'
        }
    ];

    let html = `
        <div class="apidoc-intro">
            <p class="apidoc-subtitle">RESTful 接口，所有响应均为 JSON（文件接口除外）</p>
        </div>
    `;

    endpoints.forEach((ep) => {
        const paramsHtml = ep.params ? `
            <table class="apidoc-table">
                <thead><tr><th>参数</th><th>类型</th><th>说明</th></tr></thead>
                <tbody>
                    ${ep.params.map(p => `<tr><td><code>${p.name}</code></td><td>${p.type}</td><td>${p.desc}</td></tr>`).join('')}
                </tbody>
            </table>` : '';

        const exampleHtml = ep.example ? `
            <div class="apidoc-example">
                <div class="apidoc-example-label">示例</div>
                <pre><code>${escapeHtml(ep.example)}</code></pre>
            </div>` : '';

        const notesHtml = ep.notes ? `<div class="apidoc-notes">${ep.notes}</div>` : '';

        html += `
            <div class="apidoc-endpoint">
                <div class="apidoc-ep-head">
                    <span class="apidoc-method">${ep.method}</span>
                    <span class="apidoc-path">${ep.path}</span>
                </div>
                <h4 class="apidoc-ep-title">${ep.title}</h4>
                <p class="apidoc-desc">${ep.desc}</p>
                ${paramsHtml}
                ${exampleHtml}
                ${notesHtml}
            </div>`;
    });

    return html;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    initChangelog();
    initApiDoc();
});

// ---------- Media Session API（系统媒体键支持） ----------
let mediaSessionMeta = { title: '', artist: '', album: '' };

function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const idx = state.currentIndex;
    if (idx < 0 || idx >= state.flatSongs.length) return;

    const title = mediaSessionMeta.title || currentTitleEl.textContent || '未知歌曲';
    const artist = mediaSessionMeta.artist || currentArtistEl.textContent || '未知歌手';
    const album = 'Simple Local Music Player';

    const metadata = { title, artist, album };

    // 如果有封面图，尝试添加 artwork
    const imgEl = albumArt.querySelector('img');
    if (imgEl && imgEl.src) {
        metadata.artwork = [
            { src: imgEl.src, sizes: '300x300', type: 'image/png' },
            { src: imgEl.src, sizes: '96x96', type: 'image/png' }
        ];
    }

    navigator.mediaSession.metadata = new MediaMetadata(metadata);
}

function setupMediaSessionActions() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
        if (state.currentIndex === -1 && state.flatSongs.length > 0) {
            playSong(0, true);
        } else if (!state.isPlaying) {
            safePlay().then(() => {
                state.isPlaying = true;
                updatePlayButton();
                albumArt.classList.add('playing');
                navigator.mediaSession.playbackState = 'playing';
            }).catch(() => {});
        }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
        audio.pause();
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
        navigator.mediaSession.playbackState = 'paused';
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
        } else {
            playSong(getPrevIndex(), true);
        }
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
        playSong(getNextIndex(), true);
    });

    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.max(0, audio.currentTime - skipTime);
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + skipTime);
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
            audio.currentTime = details.seekTime;
        }
    });

    navigator.mediaSession.setActionHandler('stop', () => {
        audio.pause();
        audio.currentTime = 0;
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
        navigator.mediaSession.playbackState = 'none';
    });
}

// ---------- 键盘快捷键 ----------
function handleKeydown(e) {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
        case 'Space': e.preventDefault(); playBtn.click(); break;
        case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 5); break;
        case 'ArrowRight': audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); break;
        case 'ArrowUp':
            e.preventDefault();
            volumeSlider.value = Math.min(100, parseInt(volumeSlider.value) + 5);
            audio.volume = volumeSlider.value / 100;
            updateVolumeIcon(parseInt(volumeSlider.value));
            break;
        case 'ArrowDown':
            e.preventDefault();
            volumeSlider.value = Math.max(0, parseInt(volumeSlider.value) - 5);
            audio.volume = volumeSlider.value / 100;
            updateVolumeIcon(parseInt(volumeSlider.value));
            break;
    }
}
document.addEventListener('keydown', handleKeydown);

// ---------- 列表点击 ----------
function handleSongListClick(e) {
    const folderHeader = e.target.closest('.folder-header');
    if (folderHeader) {
        e.stopPropagation();
        const folder = folderHeader.dataset.folder;
        const group = folderHeader.parentElement;
        const songsContainer = group.querySelector('.folder-songs');
        if (state.collapsedFolders.has(folder)) {
            state.collapsedFolders.delete(folder);
        } else {
            state.collapsedFolders.add(folder);
        }
        localStorage.setItem('collapsedFolders', JSON.stringify([...state.collapsedFolders]));
        group.classList.toggle('collapsed');
        songsContainer.classList.toggle('collapsed');
        return;
    }
    const songItem = e.target.closest('.song-item');
    if (songItem) {
        playSong(parseInt(songItem.dataset.index), true);
        closeMobileSongList();
    }
}
songList.addEventListener('click', handleSongListClick);
function closeMobileSongList() {
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle && menuToggle.checked) menuToggle.checked = false;
}

// ---------- 清理 ----------
function cleanup() {
    if (state.refreshInterval) clearInterval(state.refreshInterval);
    document.removeEventListener('keydown', handleKeydown);
    songList.removeEventListener('click', handleSongListClick);
    searchHistoryList.removeEventListener('click', handleSearchHistoryClick);
    audio.removeEventListener('timeupdate', handleAudioTimeUpdate);
    audio.removeEventListener('loadedmetadata', handleAudioLoadedMetadata);
    audio.removeEventListener('ended', handleAudioEnded);
    audio.removeEventListener('pause', handleAudioPause);
    audio.removeEventListener('play', handleAudioPlay);
    audio.removeEventListener('error', handleAudioError);
    stopVisualizer();
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    clearCoverUrl();
    audio.pause();
    audio.src = '';
    // 重置 Media Session
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
    }
}
window.addEventListener('beforeunload', cleanup);

// ---------- 初始化 ----------
async function init() {
    try {
        initTheme();
        setupMediaSessionActions();

        document.getElementById('themeToggle').addEventListener('click', toggleTheme);

        const savedCollapsed = localStorage.getItem('collapsedFolders');
        if (savedCollapsed) {
            try { state.collapsedFolders = new Set(JSON.parse(savedCollapsed)); } catch { }
        }
        const savedAutoRefresh = localStorage.getItem('musicAutoRefreshEnabled');
        if (savedAutoRefresh !== null) {
            state.autoRefreshEnabled = savedAutoRefresh === '1';
        }
        loadSearchHistory();
        const res = await fetch('/api/songs');
        state.songs = await res.json();
        renderSongList(state.songs);
        applyShareLinkFromQuery();
        updateAutoRefreshUi();
        if (state.autoRefreshEnabled) startAutoRefresh();

        const savedVolume = localStorage.getItem('musicVolume');
        const volume = savedVolume !== null ? parseInt(savedVolume, 10) : 80;
        volumeSlider.value = volume;
        audio.volume = volume / 100;
        updateVolumeIcon(volume);

        // 尝试自动播放（仅在非分享链接时）
        const isShareLink = new URLSearchParams(window.location.search).has('song');
        if (!isShareLink && state.flatSongs.length > 0) {
            // 默认选中第一首，但不自动播放，只加载
            playSong(0, false);
            // 延迟一下再尝试自动播放（浏览器策略需要用户交互，这里只是尝试）
            setTimeout(() => {
                attemptAutoPlayOnLoad();
            }, 300);
        }
    } catch (err) {
        songList.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon"><ion-icon name="alert-circle" size="large"></ion-icon></div>
                        <div class="empty-text">加载失败，请刷新重试</div>
                    </div>
                `;
        console.error('初始化失败:', err);
    }
}

init();