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
    lastSearchTerm: '',
    searchMode: 'normal'   // 'normal' | 'regex'
};
const SEARCH_HISTORY_KEY = 'musicSearchHistory';
const MAX_SEARCH_HISTORY = 20;
const audio = document.getElementById('audioPlayer');
const songList = document.getElementById('songList');
const songCount = document.getElementById('songCount');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const modeNormalBtn = document.getElementById('modeNormalBtn');
const modeRegexBtn = document.getElementById('modeRegexBtn');
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
const lyricsPlaceholder = document.getElementById('lyricsPlaceholder');
const lyricsLines = document.getElementById('lyricsLines');

let lyricsData = [];       // [{time: seconds, text: string}, ...]
let lyricsActiveIndex = -1;

// ===== 歌单（引用型）=====
// playlists = { "全部歌曲": [], "我喜欢的": ["folder|song", ...] }
// "全部歌曲" 为内置保留项，不可删改；其余歌单仅存储对主列表歌曲的引用标识。
const PLAYLISTS_KEY = 'musicPlaylists';
const CURRENT_PLAYLIST_KEY = 'musicCurrentPlaylist';
const BUILTIN_PLAYLIST = '全部歌曲';
let playlists = {};                 // 歌单数据
let currentPlaylist = BUILTIN_PLAYLIST; // 当前选中歌单
let selectedSongs = new Set();      // 勾选的歌曲引用标识（folder|song）

// 主列表唯一标识：folder|song（与 renderSongList 中一致）
function getSongKey(folder, song) {
    return `${folder}|${song}`;
}
// 由主列表构建合法标识集合，用于幽灵数据检测
function getValidKeySet() {
    const set = new Set();
    if (songFolders && songFolders.folders) {
        for (const folder of songFolders.folders) {
            for (const song of folder.songs) {
                set.add(getSongKey(folder.folder, song));
            }
        }
    }
    return set;
}
function loadPlaylists() {
    try {
        const raw = localStorage.getItem(PLAYLISTS_KEY);
        playlists = raw ? JSON.parse(raw) : {};
    } catch (e) {
        playlists = {};
    }
    if (!playlists || typeof playlists !== 'object' || Array.isArray(playlists)) {
        playlists = {};
    }
    if (!playlists[BUILTIN_PLAYLIST] || !Array.isArray(playlists[BUILTIN_PLAYLIST])) {
        playlists[BUILTIN_PLAYLIST] = [];
    }
    const cur = localStorage.getItem(CURRENT_PLAYLIST_KEY);
    if (!cur || !playlists[cur]) {
        currentPlaylist = BUILTIN_PLAYLIST;
    } else {
        currentPlaylist = cur;
    }
}
function savePlaylists() {
    try {
        localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
        localStorage.setItem(CURRENT_PLAYLIST_KEY, currentPlaylist);
    } catch (e) {
        console.error('保存歌单失败', e);
    }
}

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

// ---------- 统一模态提示（替代浏览器原生 prompt/confirm，风格与 toast 一致）----------
// 复用一个 overlay 容器，按需渲染内容；返回 Promise 便于 async/await 调用。
let _modalOverlay = null;
function getModalOverlay() {
    if (!_modalOverlay) {
        _modalOverlay = document.createElement('div');
        _modalOverlay.className = 'modal-overlay';
        _modalOverlay.style.display = 'none';
        document.body.appendChild(_modalOverlay);
    }
    return _modalOverlay;
}
function closeModal() {
    const overlay = getModalOverlay();
    overlay.style.display = 'none';
    overlay.innerHTML = '';
}
function showConfirm(message) {
    return new Promise((resolve) => {
        const overlay = getModalOverlay();
        overlay.innerHTML = `
            <div class="modal-box">
                <div class="modal-message">${escapeHtml(message)}</div>
                <div class="modal-actions">
                    <button type="button" class="modal-btn modal-cancel">取消</button>
                    <button type="button" class="modal-btn modal-ok">确定</button>
                </div>
            </div>`;
        overlay.style.display = 'flex';
        const ok = overlay.querySelector('.modal-ok');
        const cancel = overlay.querySelector('.modal-cancel');
        const done = (val) => {
            overlay.removeEventListener('click', onOverlay);
            closeModal();
            resolve(val);
        };
        const onOverlay = (e) => { if (e.target === overlay) done(false); };
        overlay.addEventListener('click', onOverlay);
        cancel.addEventListener('click', () => done(false));
        ok.addEventListener('click', () => done(true));
    });
}
function showPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = getModalOverlay();
        overlay.innerHTML = `
            <div class="modal-box">
                <div class="modal-message">${escapeHtml(message)}</div>
                <input type="text" class="modal-input" value="${escapeHtml(defaultValue)}" />
                <div class="modal-actions">
                    <button type="button" class="modal-btn modal-cancel">取消</button>
                    <button type="button" class="modal-btn modal-ok">确定</button>
                </div>
            </div>`;
        overlay.style.display = 'flex';
        const input = overlay.querySelector('.modal-input');
        const ok = overlay.querySelector('.modal-ok');
        const cancel = overlay.querySelector('.modal-cancel');
        input.focus();
        input.select();
        const done = (val) => {
            overlay.removeEventListener('keydown', onKey);
            overlay.removeEventListener('click', onOverlay);
            closeModal();
            resolve(val);
        };
        const onOverlay = (e) => { if (e.target === overlay) done(null); };
        const onKey = (e) => {
            if (e.key === 'Enter') done(input.value);
            else if (e.key === 'Escape') done(null);
        };
        overlay.addEventListener('click', onOverlay);
        overlay.addEventListener('keydown', onKey);
        cancel.addEventListener('click', () => done(null));
        ok.addEventListener('click', () => done(input.value));
    });
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

function highlightMatches(text, query) {
    if (!query || !query.trim()) return escapeHtml(text);
    const safeText = escapeHtml(text);
    let regex;
    if (state.searchMode === 'regex') {
        try {
            regex = new RegExp(`(${query})`, 'gi');
        } catch {
            // 非法正则：不高亮，原样返回
            return safeText;
        }
    } else {
        const safeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(`(${safeQuery})`, 'gi');
    }
    return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function isRegexValid(pattern) {
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

// 判断歌曲名是否匹配当前过滤条件（普通模式/正则模式）
function matchesFilter(name, filter) {
    if (!filter || !filter.trim()) return true;
    if (state.searchMode === 'regex') {
        if (!isRegexValid(filter)) return true; // 非法正则：不过滤，避免误清空列表
        try {
            return new RegExp(filter, 'i').test(name);
        } catch {
            return true;
        }
    }
    return name.toLowerCase().includes(filter.toLowerCase());
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
    updateLyrics(audio.currentTime);
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
    const target = state.flatSongs[index];
    if (!target || !target.folder || !target.song) {
        showToast('该歌曲引用已失效');
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
    const savedSpeed = audio.playbackRate;
    audio.pause();
    audio.src = path;
    audio.load(); // 显式加载，触发 error 事件如果文件有问题
    audio.playbackRate = savedSpeed;

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
    loadLyrics(folder, song);

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

// ---------- 歌词 ----------
function parseLrc(lrcText) {
    const lines = [];
    if (!lrcText || typeof lrcText !== 'string') return lines;
    // 匹配 [mm:ss.xx] 或 [mm:ss.xxx]
    const regex = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
    const textLines = lrcText.split('\n');
    for (const line of textLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let match;
        // 同一行可能有多个时间标签
        const timestamps = [];
        const matchRegex = new RegExp(regex.source, 'g');
        while ((match = matchRegex.exec(trimmed)) !== null) {
            const mins = parseInt(match[1], 10);
            const secs = parseInt(match[2], 10);
            const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
            timestamps.push(mins * 60 + secs + ms / 1000);
        }
        if (timestamps.length === 0) continue;
        // 提取最后的纯文本部分
        const text = trimmed.replace(regex, '').trim();
        if (!text) continue;
        for (const time of timestamps) {
            lines.push({ time, text });
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

function renderLyrics() {
    lyricsLines.innerHTML = '';
    if (lyricsData.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < lyricsData.length; i++) {
        const div = document.createElement('div');
        div.className = 'lyrics-line';
        div.textContent = lyricsData[i].text;
        div.dataset.index = i;
        div.addEventListener('click', () => {
            if (lyricsData[i].time !== undefined && audio.duration) {
                audio.currentTime = lyricsData[i].time;
            }
        });
        fragment.appendChild(div);
    }
    lyricsLines.appendChild(fragment);
}

async function loadLyrics(folder, song) {
    // 重置
    lyricsData = [];
    lyricsActiveIndex = -1;
    lyricsLines.innerHTML = '';
    lyricsLines.style.display = 'none';
    lyricsPlaceholder.textContent = '加载歌词...';
    lyricsPlaceholder.style.display = '';

    const params = new URLSearchParams();
    if (folder !== '.') params.set('folder', folder);
    params.set('song', song);
    try {
        const res = await fetch(`/api/lyrics?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch lyrics');
        const data = await res.json();
        if (data.lyrics && typeof data.lyrics === 'string') {
            lyricsData = parseLrc(data.lyrics);
        }
    } catch (err) {
        // 静默处理，不打断播放
        console.error('加载歌词失败:', err);
    }

    if (lyricsData.length > 0) {
        renderLyrics();
        lyricsLines.style.display = '';
        lyricsPlaceholder.style.display = 'none';
    } else {
        lyricsPlaceholder.textContent = '暂无歌词';
        lyricsPlaceholder.style.display = '';
        lyricsLines.style.display = 'none';
    }
}

function updateLyrics(currentTime) {
    if (lyricsData.length === 0) return;
    if (isNaN(currentTime) || currentTime === Infinity) return;

    // 找到当前时间对应的歌词行
    let newIndex = -1;
    for (let i = 0; i < lyricsData.length; i++) {
        if (lyricsData[i].time <= currentTime) {
            newIndex = i;
        } else {
            break;
        }
    }

    if (newIndex === lyricsActiveIndex) return;
    lyricsActiveIndex = newIndex;

    // 更新高亮
    const allLines = lyricsLines.querySelectorAll('.lyrics-line');
    allLines.forEach((line, i) => {
        if (i === newIndex) {
            line.classList.add('active');
            // 滚动到可视区域
            line.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
            line.classList.remove('active');
        }
    });
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
const shareMenu = document.getElementById('shareMenu');

function buildShareUrl(folder, song) {
    const params = new URLSearchParams();
    params.set('song', song);
    if (folder && folder !== '.') params.set('folder', folder);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function buildShortShareUrl(songId) {
    const params = new URLSearchParams();
    params.set('song_id', songId.toString());
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function applyShareLinkFromQuery() {
    const params = new URLSearchParams(window.location.search);

    // 优先处理 song_id（简短链接）
    const songId = params.get('song_id');
    if (songId !== null) {
        const index = parseInt(songId, 10);
        if (isNaN(index) || index < 0 || index >= state.flatSongs.length) {
            showToast('分享的歌曲不存在或已被删除');
            return;
        }
        playSong(index, false);
        return;
    }

    // 处理 song + folder（高精度链接）
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
    playSong(index, false);
}

function toggleShareMenu() {
    if (state.currentIndex === -1) return;
    const isOpen = shareMenu.classList.toggle('show');
    if (!isOpen) return;
    // 点击其他地方关闭
    const closeMenu = (e) => {
        if (!shareMenu.contains(e.target) && e.target !== shareBtn) {
            shareMenu.classList.remove('show');
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function copyShareUrl(type) {
    if (state.currentIndex === -1) return;
    const { folder, song } = state.flatSongs[state.currentIndex];
    let url;
    if (type === 'short') {
        const allSongs = state.flatAllSongs || state.flatSongs;
        const fullIndex = allSongs.findIndex(item => item.folder === folder && item.song === song);
        url = buildShortShareUrl(fullIndex);
    } else {
        url = buildShareUrl(folder, song);
    }
    shareMenu.classList.remove('show');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('分享链接已复制到剪贴板');
        }).catch(() => {
            fallbackCopy(url);
        });
    } else {
        fallbackCopy(url);
    }
}

shareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShareMenu();
});

shareMenu.addEventListener('click', (e) => {
    const option = e.target.closest('.share-option');
    if (!option) return;
    const type = option.dataset.type;
    copyShareUrl(type);
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
function setSearchMode(mode) {
    state.searchMode = mode;
    const isRegex = mode === 'regex';
    modeNormalBtn.classList.toggle('active', !isRegex);
    modeRegexBtn.classList.toggle('active', isRegex);
    searchInput.placeholder = isRegex ? '输入正则表达式，如 周杰伦|林俊杰' : '搜索音乐...';
    searchInput.classList.remove('regex-invalid');
    // 重新渲染当前结果
    renderSongList(state.songs, searchInput.value);
}

modeNormalBtn.addEventListener('click', () => setSearchMode('normal'));
modeRegexBtn.addEventListener('click', () => setSearchMode('regex'));

searchInput.addEventListener('input', debounce((e) => {
    const value = e.target.value;
    // 正则模式下，非法正则给出视觉提示
    if (state.searchMode === 'regex') {
        searchInput.classList.toggle('regex-invalid', value.trim() !== '' && !isRegexValid(value));
    }
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
async function clearAllSearchHistory() {
    if (state.searchHistory.length === 0) return;
    if (!(await showConfirm('确定要清空所有搜索历史吗？'))) return;
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

// ============ 歌单功能 ============
const playlistSelect = document.getElementById('playlistSelect');
const playlistNewBtn = document.getElementById('playlistNewBtn');
const playlistRenameBtn = document.getElementById('playlistRenameBtn');
const playlistDeleteBtn = document.getElementById('playlistDeleteBtn');
const playlistBatchBtn = document.getElementById('playlistBatchBtn');

// 渲染下拉选择器（全部歌曲始终位于首位且不可删改）
function renderPlaylistSelect() {
    const names = Object.keys(playlists);
    names.sort((a, b) => {
        if (a === BUILTIN_PLAYLIST) return -1;
        if (b === BUILTIN_PLAYLIST) return 1;
        return a.localeCompare(b);
    });
    playlistSelect.innerHTML = '';
    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = (name === BUILTIN_PLAYLIST ? '全部歌曲' : name);
        playlistSelect.appendChild(opt);
    }
    playlistSelect.value = currentPlaylist;
    // “全部歌曲” 不可改名/删除
    const isBuiltin = (currentPlaylist === BUILTIN_PLAYLIST);
    playlistRenameBtn.disabled = isBuiltin;
    playlistDeleteBtn.disabled = isBuiltin;
    playlistRenameBtn.classList.toggle('disabled', isBuiltin);
    playlistDeleteBtn.classList.toggle('disabled', isBuiltin);
    playlistBatchBtn.style.display = isBuiltin ? 'none' : '';
}

// 切换歌单：切换后自动比对主列表，剔除失效幽灵（无需用户点击）
function switchPlaylist(name) {
    if (!playlists[name]) return;
    currentPlaylist = name;
    selectedSongs.clear(); // 切换歌单时清空勾选态
    savePlaylists();
    renderPlaylistSelect();
    purgeGhostsIfAny(); // 切换时自动剔除已失效引用
    renderSongList(state.songs, searchInput.value);
}

// 从歌单移除指定引用（单行“移出”）
function removeFromPlaylist(key) {
    const list = playlists[currentPlaylist];
    if (!list) return;
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    selectedSongs.delete(key);
    savePlaylists();
    renderSongList(state.songs, searchInput.value);
}

// 移除幽灵引用并重渲染
function removeGhostFromPlaylist(key) {
    const list = playlists[currentPlaylist];
    if (!list) return;
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    savePlaylists();
    renderSongList(state.songs, searchInput.value);
}

// 切换/初始化时自动比对主列表，剔除失效幽灵引用
function purgeGhostsIfAny() {
    if (currentPlaylist === BUILTIN_PLAYLIST) return;
    const list = playlists[currentPlaylist];
    if (!list || !list.length) return;
    const validKeys = getValidKeySet();
    const before = list.length;
    playlists[currentPlaylist] = list.filter(key => validKeys.has(key));
    if (playlists[currentPlaylist].length !== before) {
        savePlaylists();
    }
}

// 将勾选歌曲加入当前歌单（批量）
function batchAddToPlaylist() {
    if (currentPlaylist === BUILTIN_PLAYLIST) {
        showToast('请先选择一个自定义歌单');
        return;
    }
    if (selectedSongs.size === 0) {
        showToast('请先在歌曲行左侧勾选要加入的歌曲');
        return;
    }
    const list = playlists[currentPlaylist] || (playlists[currentPlaylist] = []);
    const existing = new Set(list); // 用 Set 去重，避免歌单内出现重复引用
    let added = 0;
    for (const key of selectedSongs) {
        if (!existing.has(key)) {
            list.push(key);
            existing.add(key);
            added++;
        }
    }
    savePlaylists();
    selectedSongs.clear();
    renderSongList(state.songs, searchInput.value);
    showToast(added > 0 ? `已加入 ${added} 首到「${currentPlaylist}」` : '所选歌曲已在歌单中');
}

// 新建歌单（重名校验）
async function createPlaylist() {
    const name = await showPrompt('请输入新歌单名称：');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
        showToast('歌单名称不能为空');
        return;
    }
    if (playlists[trimmed]) {
        showToast('已存在同名歌单，请换一个名称');
        return;
    }
    playlists[trimmed] = [];
    currentPlaylist = trimmed;
    savePlaylists();
    renderPlaylistSelect();
    renderSongList(state.songs, searchInput.value);
    showToast(`已创建歌单「${trimmed}」`);
}

// 重命名歌单（重名拦截，内置项不可改名）
async function renamePlaylist() {
    if (currentPlaylist === BUILTIN_PLAYLIST) {
        showToast('“全部歌曲”不可重命名');
        return;
    }
    const name = await showPrompt('请输入新的歌单名称：', currentPlaylist);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
        showToast('歌单名称不能为空');
        return;
    }
    if (trimmed === currentPlaylist) return;
    if (playlists[trimmed]) {
        showToast('已存在同名歌单，请换一个名称');
        return;
    }
    const refs = playlists[currentPlaylist];
    delete playlists[currentPlaylist];
    playlists[trimmed] = refs;
    currentPlaylist = trimmed;
    savePlaylists();
    renderPlaylistSelect();
    renderSongList(state.songs, searchInput.value);
    showToast(`已重命名为「${trimmed}」`);
}

// 删除歌单（二次确认，内置项不可删）
async function deletePlaylist() {
    if (currentPlaylist === BUILTIN_PLAYLIST) {
        showToast('“全部歌曲”不可删除');
        return;
    }
    if (!(await showConfirm(`确定要删除歌单“${currentPlaylist}”吗？该操作不可恢复。`))) return;
    delete playlists[currentPlaylist];
    currentPlaylist = BUILTIN_PLAYLIST;
    savePlaylists();
    renderPlaylistSelect();
    renderSongList(state.songs, searchInput.value);
    showToast('歌单已删除');
}

// 初始化歌单（加载数据、绑定事件、渲染选择器和列表）
function initPlaylists() {
    loadPlaylists();
    renderPlaylistSelect();
    playlistSelect.addEventListener('change', () => switchPlaylist(playlistSelect.value));
    playlistNewBtn.addEventListener('click', createPlaylist);
    playlistRenameBtn.addEventListener('click', renamePlaylist);
    playlistDeleteBtn.addEventListener('click', deletePlaylist);
    playlistBatchBtn.addEventListener('click', batchAddToPlaylist);
    // 首次进入：自动剔除各歌单中可能存在的失效引用
    for (const name of Object.keys(playlists)) {
        if (name === BUILTIN_PLAYLIST) continue;
        const list = playlists[name];
        const validKeys = getValidKeySet();
        const before = list.length;
        playlists[name] = list.filter(key => validKeys.has(key));
        if (playlists[name].length !== before) savePlaylists();
    }
}

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
    const isFullList = (filter === '');
    const isAllPlaylist = (currentPlaylist === BUILTIN_PLAYLIST);
    const showItemControls = !isAllPlaylist; // 仅自定义歌单显示勾选/移出
    let totalSongs = 0;

    // 当前歌单引用的合法标识集合（用于过滤与幽灵检测）
    const playlistRefs = isAllPlaylist ? null : (playlists[currentPlaylist] || []);
    const validKeys = getValidKeySet();
    // 自定义歌单内的幽灵标识（主列表已不存在）
    const ghostKeys = [];
    if (!isAllPlaylist && playlistRefs) {
        for (const key of playlistRefs) {
            if (!validKeys.has(key)) ghostKeys.push(key);
        }
    }

    const folders = Object.keys(songs).sort((a, b) => {
        if (a === '.') return -1;
        if (b === '.') return 1;
        return a.localeCompare(b);
    });
    for (const folder of folders) {
        let songsInFolder = songs[folder].filter(name => matchesFilter(name, filter));
        // 自定义歌单：只保留被引用的歌曲
        if (!isAllPlaylist && playlistRefs) {
            const refSet = new Set(playlistRefs);
            songsInFolder = songsInFolder.filter(name => refSet.has(getSongKey(folder, name)));
        }
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
            const item = createSongItem(folder, song, totalSongs + 1, filter, showItemControls);
            songsContainer.appendChild(item);
            state.flatSongs.push({ folder, song });
            totalSongs++;
        }
        group.appendChild(songsContainer);
        songList.appendChild(group);
    }

    // 渲染幽灵引用行（标红），点击弹窗提示并剔除
    for (const ghostKey of ghostKeys) {
        const item = createGhostItem(ghostKey, totalSongs + 1);
        const ghostGroup = document.createElement('div');
        ghostGroup.className = 'folder-group';
        const songsContainer = document.createElement('div');
        songsContainer.className = 'folder-songs';
        songsContainer.appendChild(item);
        ghostGroup.appendChild(songsContainer);
        songList.appendChild(ghostGroup);
        state.flatSongs.push({ folder: '', song: '', ghost: true, key: ghostKey });
        totalSongs++;
    }

    if (isFullList) {
        state.flatAllSongs = [...state.flatSongs];
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
                        <div class="empty-text">${
                            filter ? '没有找到匹配的歌曲'
                            : isAllPlaylist ? '将音乐文件放入 music 文件夹'
                            : '当前歌单还没有歌曲，勾选歌曲后点击 ⇲ 加入'
                        }</div>
                    </div>
                `;
    }
    songList.scrollTop = currentScroll;
    updateActiveItem(currentSong);
}

// 创建普通歌曲行（含可选勾选框与移出按钮）
function createSongItem(folder, song, num, filter, showItemControls) {
    const item = document.createElement('div');
    item.className = 'song-item';
    item.dataset.index = state.flatSongs.length;
    item.dataset.folder = folder;
    item.dataset.song = song;
    if (showItemControls) {
        const key = getSongKey(folder, song);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'song-checkbox';
        checkbox.dataset.key = key;
        checkbox.checked = selectedSongs.has(key);
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selectedSongs.add(key);
            else selectedSongs.delete(key);
        });
        item.appendChild(checkbox);
    } else {
        const numSpan = document.createElement('span');
        numSpan.className = 'song-num-placeholder';
        item.appendChild(numSpan);
    }
    const numEl = document.createElement('span');
    numEl.className = 'song-num';
    numEl.textContent = String(num).padStart(2, '0');
    const playIcon = document.createElement('span');
    playIcon.className = 'song-play';
    playIcon.innerHTML = '<ion-icon name="play" size="small"></ion-icon>';
    const info = document.createElement('div');
    info.className = 'song-info';
    const title = document.createElement('div');
    title.className = 'song-title-text';
    if (filter && filter.trim()) {
        title.innerHTML = highlightMatches(song.replace(/\.[^.]+$/, ''), filter);
    } else {
        title.textContent = song.replace(/\.[^.]+$/, '');
    }
    const folderName = document.createElement('div');
    folderName.className = 'song-folder';
    folderName.textContent = folder === '.' ? '根目录' : folder;
    info.appendChild(title);
    info.appendChild(folderName);
    item.appendChild(numEl);
    item.appendChild(playIcon);
    item.appendChild(info);
    if (showItemControls) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'song-remove-btn';
        removeBtn.type = 'button';
        removeBtn.title = '移出当前歌单';
        removeBtn.innerHTML = '<ion-icon name="close-circle" size="small"></ion-icon>';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromPlaylist(getSongKey(folder, song));
        });
        item.appendChild(removeBtn);
    }
    return item;
}

// 创建幽灵引用行（歌曲已失效，标红提示）
function createGhostItem(ghostKey, num) {
    const item = document.createElement('div');
    item.className = 'song-item song-ghost';
    item.dataset.ghostKey = ghostKey;
    const numEl = document.createElement('span');
    numEl.className = 'song-num';
    numEl.textContent = String(num).padStart(2, '0');
    const info = document.createElement('div');
    info.className = 'song-info';
    const title = document.createElement('div');
    title.className = 'song-title-text';
    title.textContent = ghostKey.replace(/\|/g, ' / ');
    const folderName = document.createElement('div');
    folderName.className = 'song-folder';
    folderName.textContent = '歌曲已失效（文件不存在）';
    info.appendChild(title);
    info.appendChild(folderName);
    item.appendChild(numEl);
    item.appendChild(info);
    item.addEventListener('click', async (e) => {
        e.stopPropagation(); // 避免触发 songList 的播放委托
        if (await showConfirm(`歌曲「${ghostKey}」已失效，是否从歌单“${currentPlaylist}”中移除？`)) {
            removeGhostFromPlaylist(ghostKey);
        }
    });
    return item;
}

// ---------- 自动播放尝试（页面加载时） ----------
function attemptAutoPlayOnLoad() {
    // 如果是分享链接，不自动播放
    const shareParams = new URLSearchParams(window.location.search);
    if (shareParams.has('song') || shareParams.has('song_id')) return;
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
        localStorage.setItem('musicSpeed', speed);
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

    let currentPage = 1;
    const PER_PAGE = 20;

    changelogBtn.addEventListener('click', () => showChangelog());
    changelogClose.addEventListener('click', hideChangelog);
    changelogOverlay.addEventListener('click', hideChangelog);
    changelogPagination.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.classList.contains('active')) return;
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

    async function loadChangelog(page) {
        currentPage = page;
        changelogContent.innerHTML = '<div class="loading-container"><div class="spinner"></div><span>正在加载...</span></div>';
        changelogPagination.innerHTML = '';
        try {
            const res = await fetch(`/api/commits?per_page=${PER_PAGE}&page=${page}`);
            const commits = await res.json();
            if (!Array.isArray(commits)) throw new Error('数据格式错误');
            if (commits.length === 0) {
                changelogContent.innerHTML = '<div class="changelog-empty">暂无更新日志</div>';
                return;
            }
            changelogContent.innerHTML = commits.map(commit => {
                const date = new Date(commit.commit.author.date);
                const timeStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
                const author = commit.author || commit.commit.author;
                const avatar = author && author.avatar_url ? author.avatar_url : '';
                const authorName = author ? (author.login || author.name || '未知') : '未知';
                return `
                    <div class="changelog-item">
                        <div class="changelog-item-header">
                            ${avatar ? `<img class="changelog-avatar" src="${avatar}" alt="${authorName}" loading="lazy">` : ''}
                            <span class="changelog-commit">${commit.sha.substring(0, 7)}</span>
                        </div>
                        <div class="changelog-message">${escapeHtml(commit.commit.message)}</div>
                        <div class="changelog-meta">
                            <span class="changelog-author"><span>${escapeHtml(authorName)}</span></span>
                            <span class="changelog-date">${timeStr}</span>
                        </div>
                    </div>`;
            }).join('');
            renderPagination(page, commits.length === PER_PAGE);
        } catch (err) {
            changelogContent.innerHTML = '<div class="changelog-error">加载失败：' + err.message + '</div>';
        }
    }

    function renderPagination(page, hasNext) {
        const hasPrev = page > 1;
        if (!hasPrev && !hasNext) return;
        let html = '';
        html += `<button data-page="${page - 1}"${hasPrev ? '' : ' disabled'}>上一页</button>`;
        html += `<span class="changelog-page-info">第 ${page} 页</span>`;
        html += `<button data-page="${page + 1}"${hasNext ? '' : ' disabled'}>下一页</button>`;
        changelogPagination.innerHTML = html;
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
        initPlaylists(); // 加载歌单数据、绑定事件、按当前歌单渲染列表
        applyShareLinkFromQuery();
        updateAutoRefreshUi();
        if (state.autoRefreshEnabled) startAutoRefresh();

        const savedVolume = localStorage.getItem('musicVolume');
        const volume = savedVolume !== null ? parseInt(savedVolume, 10) : 80;
        volumeSlider.value = volume;
        audio.volume = volume / 100;
        updateVolumeIcon(volume);

        // 恢复播放速度
        const savedSpeed = localStorage.getItem('musicSpeed');
        if (savedSpeed !== null) {
            const speed = parseFloat(savedSpeed);
            audio.playbackRate = speed;
            speedLabel.textContent = speed.toFixed(2) + 'x';
        }

        // 尝试自动播放（仅在非分享链接时）
        const qParams = new URLSearchParams(window.location.search);
        const isShareLink = qParams.has('song') || qParams.has('song_id');
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