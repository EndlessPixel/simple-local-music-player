const state = {
    songs: {},
    flatSongs: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 0,
    collapsedFolders: new Set(),
    refreshCountdown: 30,
    refreshInterval: null,
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
const repeatBtn = document.getElementById('repeatBtn');
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
async function init() {
    try {
        const savedCollapsed = localStorage.getItem('collapsedFolders');
        if (savedCollapsed) {
            try {
                state.collapsedFolders = new Set(JSON.parse(savedCollapsed));
            } catch {
                state.collapsedFolders = new Set();
            }
        }
        loadSearchHistory();
        const res = await fetch('/api/songs');
        state.songs = await res.json();
        renderSongList(state.songs);
        startAutoRefresh();
        const savedVolume = localStorage.getItem('musicVolume');
        const volume = savedVolume ? parseInt(savedVolume) : 80;
        volumeSlider.value = volume;
        audio.volume = volume / 100;
        updateVolumeIcon(volume);
    } catch (err) {
        songList.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">
                            <ion-icon name="alert-circle" size="large"></ion-icon>
                        </div>
                        <div class="empty-text">加载失败，请刷新重试</div>
                    </div>
                `;
        console.error('加载音乐列表失败:', err);
    }
}

// 渲染歌曲列表
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
                    <span class="folder-toggle">
                        <ion-icon name="chevron-down" size="small"></ion-icon>
                    </span>
                    <span class="folder-icon">
                        <ion-icon name="${folder === '.' ? 'folder-open' : 'folder'}" size="small"></ion-icon>
                    </span>
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
            `;

    if (totalSongs === 0) {
        songList.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">
                            <ion-icon name="musical-notes" size="large"></ion-icon>
                        </div>
                        <div class="empty-text">${filter ? '没有找到匹配的歌曲' : '将音乐文件放入 music 文件夹'}</div>
                    </div>
                `;
    }

    songList.scrollTop = currentScroll;
    updateActiveItem(currentSong);
}

// 更新当前播放项高亮
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

// 自动刷新
function startAutoRefresh() {
    if (state.refreshInterval) return;
    state.refreshInterval = setInterval(() => {
        state.refreshCountdown--;
        const autoRefreshEl = document.getElementById('autoRefresh');
        if (autoRefreshEl) {
            autoRefreshEl.textContent = `自动刷新: ${state.refreshCountdown}s`;
        }
        if (state.refreshCountdown <= 0) {
            state.refreshCountdown = 30;
            refreshSongList();
        }
    }, 1000);
}

async function refreshSongList() {
    try {
        const res = await fetch('/api/songs');
        state.songs = await res.json();
        renderSongList(state.songs, searchInput.value);
    } catch (err) {
        console.error('刷新失败:', err);
    }
}

let currentCoverUrl = null;

// 清理封面 URL
function clearCoverUrl() {
    if (currentCoverUrl) {
        URL.revokeObjectURL(currentCoverUrl);
        currentCoverUrl = null;
    }
}

// 请求封面
async function loadCover(folder, song) {
    clearCoverUrl();

    const params = new URLSearchParams();
    if (folder !== '.') {
        params.set('folder', folder);
    }
    params.set('song', song);

    try {
        const res = await fetch(`/api/cover?${params.toString()}`);
        if (res.ok) {
            const blob = await res.blob();
            currentCoverUrl = URL.createObjectURL(blob);
            albumArt.innerHTML = `<img src="${currentCoverUrl}" alt="封面" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">`;
            return;
        }
    } catch {
    }

    albumArt.innerHTML = '<ion-icon name="musical-notes"></ion-icon>';
}

// 加载元数据（歌手、时长）
async function loadMeta(folder, song) {
    const params = new URLSearchParams();
    if (folder !== '.') {
        params.set('folder', folder);
    }
    params.set('song', song);

    try {
        const res = await fetch(`/api/meta?${params.toString()}`);
        if (res.ok) {
            const meta = await res.json();

            // 显示歌手
            if (meta.artist) {
                currentArtistEl.textContent = meta.artist;
            } else {
                currentArtistEl.textContent = '';
            }

            // 显示时长
            if (meta.duration) {
                totalTimeEl.textContent = formatTime(meta.duration);
            }
        }
    } catch {
    }
}

// 播放歌曲
function playSong(index) {
    if (index < 0 || index >= state.flatSongs.length) return;

    state.currentIndex = index;
    const { folder, song } = state.flatSongs[index];
    const path = folder === '.' ? `/${song}` : `/${folder}/${song}`;

    audio.src = encodeURI(path);
    audio.play();
    state.isPlaying = true;
    updatePlayButton();
    loadCover(folder, song);
    loadMeta(folder, song);

    updateActiveItem({ folder, song });
    scrollToFolder(folder);

    currentTitleEl.textContent = song.replace(/\.[^.]+$/, '');
    const pathDisplay = folder === '.' ? song : `${folder}/${song}`;
    currentPathEl.textContent = pathDisplay;
    albumArt.classList.add('playing');
}

// 滚动到指定文件夹
function scrollToFolder(folder) {
    // 找到对应的文件夹组
    const folderGroups = songList.querySelectorAll('.folder-group');
    let targetGroup = null;

    folderGroups.forEach(group => {
        const header = group.querySelector('.folder-header');
        if (header && header.dataset.folder === folder) {
            targetGroup = group;
        }
    });

    if (!targetGroup) return;

    // 如果文件夹是折叠状态，先展开
    if (targetGroup.classList.contains('collapsed')) {
        state.collapsedFolders.delete(folder);
        localStorage.setItem('collapsedFolders', JSON.stringify([...state.collapsedFolders]));
        targetGroup.classList.remove('collapsed');
        const songsContainer = targetGroup.querySelector('.folder-songs');
        if (songsContainer) {
            songsContainer.classList.remove('collapsed');
        }
    }

    // 检查是否在可视区域内
    const containerRect = songList.getBoundingClientRect();
    const groupRect = targetGroup.getBoundingClientRect();

    // 如果文件夹不在可视区域顶部位置，滚动到顶部
    if (groupRect.top < containerRect.top || groupRect.top > containerRect.top + 100) {
        songList.scrollTo({
            top: targetGroup.offsetTop - 10,
            behavior: 'smooth'
        });
    }
}

// 更新播放按钮
function updatePlayButton() {
    const iconPlay = playBtn.querySelector('.icon-play');
    const iconPause = playBtn.querySelector('.icon-pause');
    iconPlay.style.display = state.isPlaying ? 'none' : 'block';
    iconPause.style.display = state.isPlaying ? 'block' : 'none';
}

// 更新音量图标
function updateVolumeIcon(volume) {
    const high = document.querySelector('.icon-volume-high');
    const low = document.querySelector('.icon-volume-low');
    const mute = document.querySelector('.icon-volume-mute');
    high.style.display = volume > 50 ? 'block' : 'none';
    low.style.display = volume > 0 && volume <= 50 ? 'block' : 'none';
    mute.style.display = volume === 0 ? 'block' : 'none';
}

// 更新播放模式按钮图标
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

// 格式化时间
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 获取下一首
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

// 获取上一首
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

// 事件监听
playBtn.addEventListener('click', () => {
    if (state.currentIndex === -1 && state.flatSongs.length > 0) {
        playSong(0);
    } else if (state.isPlaying) {
        audio.pause();
        state.isPlaying = false;
    } else {
        audio.play();
        state.isPlaying = true;
    }
    updatePlayButton();
});

prevBtn.addEventListener('click', () => {
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
    } else {
        playSong(getPrevIndex());
    }
});

nextBtn.addEventListener('click', () => {
    playSong(getNextIndex());
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
    const path = folder === '.' ? `/${song}` : `/${folder}/${song}`;

    const link = document.createElement('a');
    link.href = encodeURI(path);
    link.download = song;
    link.click();
});

progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
});

volumeSlider.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value);
    audio.volume = volume / 100;
    updateVolumeIcon(volume);
    localStorage.setItem('musicVolume', volume.toString());
});

searchInput.addEventListener('input', (e) => {
    const value = e.target.value;
    renderSongList(state.songs, value);
    if (value.trim()) {
        showSearchHistory();
    } else {
        hideSearchHistory();
    }
});

searchInput.addEventListener('focus', () => {
    if (state.searchHistory.length > 0) {
        showSearchHistory();
    }
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const term = searchInput.value.trim();
        if (term) {
            addSearchHistory(term);
        }
        hideSearchHistory();
        searchInput.blur();
    } else if (e.key === 'Escape') {
        hideSearchHistory();
        searchInput.blur();
    }
});

// 点击其他区域关闭搜索历史
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
        hideSearchHistory();
    }
});

// 阻止搜索历史区域的点击事件冒泡
searchHistoryEl.addEventListener('click', (e) => {
    e.stopPropagation();
});

// 搜索历史相关函数
function loadSearchHistory() {
    try {
        const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
        if (saved) {
            state.searchHistory = JSON.parse(saved);
        }
    } catch {
        state.searchHistory = [];
    }
    renderSearchHistory();
}

function saveSearchHistory() {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(state.searchHistory));
}

function addSearchHistory(term) {
    // 不记录空搜索或仅包含空格的搜索
    const trimmed = term.trim();
    if (!trimmed) return;

    // 避免记录重复的连续搜索关键词
    if (state.lastSearchTerm === trimmed) return;
    state.lastSearchTerm = trimmed;

    // 移除已存在的相同记录（后面会添加到最前面）
    state.searchHistory = state.searchHistory.filter(h => h.term !== trimmed);

    // 添加到最前面
    state.searchHistory.unshift({
        term: trimmed,
        timestamp: Date.now()
    });

    // 限制最大条数
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
            setTimeout(() => {
                item.classList.add('removing');
            }, i * 50);
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
        searchHistoryList.innerHTML = `
                    <div class="search-history-empty">${filter ? '没有匹配的搜索历史' : '暂无搜索历史'}</div>
                `;
        clearHistoryBtn.style.display = 'none';
        return;
    }

    clearHistoryBtn.style.display = 'block';
    // 使用 term 作为唯一标识，避免索引问题
    searchHistoryList.innerHTML = filtered.map((item) => `
                <div class="search-history-item" data-term="${escapeHtml(item.term)}">
                    <ion-icon name="search" size="small"></ion-icon>
                    <span class="search-history-text">${escapeHtml(item.term)}</span>
                    <button class="search-history-delete" data-term="${escapeHtml(item.term)}" title="删除">
                        <ion-icon name="close" size="small"></ion-icon>
                    </button>
                </div>
            `).join('');

    // 绑定点击事件
    searchHistoryList.querySelectorAll('.search-history-item').forEach((item) => {
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.search-history-delete')) {
                const term = item.dataset.term;
                searchInput.value = term;
                renderSongList(state.songs, term);
                hideSearchHistory();
            }
        });
    });

    searchHistoryList.querySelectorAll('.search-history-delete').forEach((btn) => {
        btn.addEventListener('click', (e) => deleteSearchHistory(btn.dataset.term, e));
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

clearHistoryBtn.addEventListener('click', clearAllSearchHistory);

refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('loading');
    try {
        await refreshSongList();
        state.refreshCountdown = 30;
    } catch (err) {
        console.error('刷新失败:', err);
    } finally {
        refreshBtn.classList.remove('loading');
    }
});

audio.addEventListener('timeupdate', () => {
    const percent = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = `${percent}%`;
    currentTimeEl.textContent = formatTime(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
    totalTimeEl.textContent = formatTime(audio.duration);
});

audio.addEventListener('ended', () => {
    if (state.repeatMode === 1) {
        audio.currentTime = 0;
        audio.play();
    } else if (state.isShuffle || state.currentIndex < state.flatSongs.length - 1) {
        playSong(getNextIndex());
    } else {
        state.isPlaying = false;
        updatePlayButton();
        albumArt.classList.remove('playing');
    }
});

audio.addEventListener('pause', () => {
    albumArt.classList.remove('playing');
    stopVisualizer();
});

audio.addEventListener('play', () => {
    albumArt.classList.add('playing');
    startVisualizer();
});

// 音频可视化器
let audioCtx;
let analyser;
let dataArray;
let animationId;
let source;

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
    if (!audioCtx) {
        initVisualizer();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    drawVisualizer();
}

function stopVisualizer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

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
        gradient.addColorStop(0, '#f472b6');
        gradient.addColorStop(1, '#6366f1');

        ctx.fillStyle = gradient;

        const roundedHeight = barHeight > 0 ? Math.max(2, barHeight) : 0;
        const cornerRadius = Math.min(4, roundedHeight / 2);

        ctx.beginPath();
        ctx.roundRect(x, height - roundedHeight, barWidth, roundedHeight, [cornerRadius, cornerRadius, 0, 0]);
        ctx.fill();

        x += barWidth + gap;
    }
}

// 播放速度控制
const SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
let currentSpeed = 1.0;

speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    speedMenu.classList.toggle('show');
});

speedMenu.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        const speed = parseFloat(e.target.dataset.speed);
        setPlaybackSpeed(speed);
        speedMenu.classList.remove('show');
    }
});

function setPlaybackSpeed(speed) {
    currentSpeed = speed;
    audio.playbackRate = speed;
    speedLabel.textContent = speed === 1.0 ? '1.0x' : speed + 'x';

    speedMenu.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
    });
}

document.addEventListener('click', (e) => {
    if (!speedBtn.contains(e.target) && !speedMenu.contains(e.target)) {
        speedMenu.classList.remove('show');
    }
});

// 更新日志功能
let currentPage = 1;
const PER_PAGE = 20;

function initChangelog() {
    const changelogBtn = document.getElementById('changelogBtn');
    const changelogPanel = document.getElementById('changelogPanel');
    const changelogOverlay = document.getElementById('changelogOverlay');
    const changelogClose = document.getElementById('changelogClose');
    const changelogContent = document.getElementById('changelogContent');
    const changelogPagination = document.getElementById('changelogPagination');

    changelogBtn.addEventListener('click', () => {
        showChangelog();
    });

    changelogClose.addEventListener('click', () => {
        hideChangelog();
    });

    changelogOverlay.addEventListener('click', () => {
        hideChangelog();
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
        changelogContent.innerHTML = `
                    <div class="loading-container">
                        <div class="spinner"></div>
                        <span>正在加载...</span>
                    </div>
                `;

        try {
            const res = await fetch(`/api/commits?per_page=${PER_PAGE}&page=${page}`);
            const commits = await res.json();

            if (!Array.isArray(commits)) {
                changelogContent.innerHTML = '<div class="changelog-error">加载失败，请重试</div>';
                changelogPagination.innerHTML = '';
                return;
            }

            if (commits.length === 0) {
                changelogContent.innerHTML = '<div class="changelog-empty">暂无更新日志</div>';
                changelogPagination.innerHTML = '';
                return;
            }

            renderChangelog(commits);
            renderPagination(page, commits.length);
        } catch (err) {
            changelogContent.innerHTML = '<div class="changelog-error">加载失败：' + err.message + '</div>';
            changelogPagination.innerHTML = '';
        }
    }

    function renderChangelog(commits) {
        changelogContent.innerHTML = commits.map(commit => {
            const date = new Date(commit.commit.author.date).toLocaleString('zh-CN');
            const author = commit.author || commit.commit.author;
            const avatar = author && author.avatar_url ? author.avatar_url : '';
            const authorName = author ? (author.login || author.name || '未知作者') : '未知作者';

            return `
                        <div class="changelog-item">
                            <div class="changelog-commit">${commit.sha.substring(0, 7)}</div>
                            <div class="changelog-message">${escapeHtml(commit.commit.message)}</div>
                            <div class="changelog-author">
                                ${avatar ? `<img src="${avatar}" alt="${authorName}">` : ''}
                                <span>${authorName}</span>
                            </div>
                            <div class="changelog-date">${date}</div>
                        </div>
                    `;
        }).join('');
    }

    function renderPagination(page, count) {
        const hasPrev = page > 1;
        const hasNext = count === PER_PAGE;

        let html = '';

        if (hasPrev) {
            html += `<button onclick="loadChangelog(${page - 1})">上一页</button>`;
        }

        html += `<button class="active">${page}</button>`;

        if (hasNext) {
            html += `<button onclick="loadChangelog(${page + 1})">下一页</button>`;
        }

        changelogPagination.innerHTML = html;
    }
}

document.addEventListener('DOMContentLoaded', initChangelog);

// API 文档功能
function initApiDoc() {
    const apiDocBtn = document.getElementById('apiDocBtn');
    const apiDocPanel = document.getElementById('apidocPanel');
    const apiDocOverlay = document.getElementById('apidocOverlay');
    const apiDocClose = document.getElementById('apidocClose');
    const apiDocContent = document.getElementById('apidocContent');

    apiDocBtn.addEventListener('click', () => {
        showApiDoc();
    });

    apiDocClose.addEventListener('click', () => {
        hideApiDoc();
    });

    apiDocOverlay.addEventListener('click', () => {
        hideApiDoc();
    });

    function showApiDoc() {
        apiDocPanel.classList.add('show');
        apiDocOverlay.classList.add('show');
        loadApiDoc();
    }

    function hideApiDoc() {
        apiDocPanel.classList.remove('show');
        apiDocOverlay.classList.remove('show');
    }

    async function loadApiDoc() {
        apiDocContent.innerHTML = `
                    <div class="loading-container">
                        <div class="spinner"></div>
                        <span>正在加载...</span>
                    </div>
                `;

        try {
            const res = await fetch('/api/doc');
            const doc = await res.json();
            renderApiDoc(doc);
        } catch (err) {
            apiDocContent.innerHTML = '<div class="changelog-error">加载失败：' + err.message + '</div>';
        }
    }

    function renderApiDoc(doc) {
        apiDocContent.innerHTML = doc.endpoints.map(ep => {
            const params = ep.parameters ? Object.entries(ep.parameters).map(([key, val]) =>
                `<div class="apidoc-param"><code>${key}</code>: ${val}</div>`
            ).join('') : '';

            return `
                        <div class="apidoc-endpoint">
                            <div>
                                <span class="apidoc-method">${ep.method}</span>
                                <span class="apidoc-path">${ep.path}</span>
                            </div>
                            <div class="apidoc-desc">${ep.description}</div>
                            ${params ? `<div class="apidoc-params"><div class="apidoc-params-title">参数：</div>${params}</div>` : ''}
                        </div>
                    `;
        }).join('');
    }
}

document.addEventListener('DOMContentLoaded', initApiDoc);

// 键盘快捷键
function handleKeydown(e) {
    if (e.target.tagName === 'INPUT') return;

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            playBtn.click();
            break;
        case 'ArrowLeft':
            audio.currentTime = Math.max(0, audio.currentTime - 5);
            break;
        case 'ArrowRight':
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
            break;
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
        playSong(parseInt(songItem.dataset.index));
    }
}

songList.addEventListener('click', handleSongListClick);

// 清理函数
function cleanup() {
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
    }
    document.removeEventListener('keydown', handleKeydown);
    songList.removeEventListener('click', handleSongListClick);
    stopVisualizer();
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    clearCoverUrl();
    audio.pause();
    audio.src = '';
}

window.addEventListener('beforeunload', cleanup);

// 启动
init();