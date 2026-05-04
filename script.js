const p = document.getElementById('player');
const list = document.getElementById('list');
const status = document.getElementById('status');
const search = document.getElementById('search');
const loopBtn = document.getElementById('loop');

let songs = [], idx = 0, loopMode = 'list';
let isLoadingSongs = false;
let isSeeking = false; // 标记是否在拖拽进度条

// 音量记忆
p.volume = parseFloat(localStorage.getItem('volume')) || 0.7;
window.onload = loadSongs;

// 快捷键
document.addEventListener('keydown', e => {
    if (search === document.activeElement) return;
    if (e.code === 'Space') {
        e.preventDefault();
        if (songs.length === 0) return;
        p.paused ? p.play() : p.pause();
    }
    if (e.code === 'ArrowLeft') prev();
    if (e.code === 'ArrowRight') next();
});

// 搜索
search.oninput = () => {
    const kw = search.value.trim().toLowerCase();
    document.querySelectorAll('.song-item').forEach((el, i) => {
        el.hidden = !songs[i]?.path.toLowerCase().includes(kw);
    });
};

// 加载歌曲
async function loadSongs() {
    if (isLoadingSongs) return;
    isLoadingSongs = true;

    list.innerHTML = '<div class="text-gray-400 text-center py-4">加载歌曲列表...</div>';
    status.textContent = "加载中...";

    try {
        const res = await fetch('/api/songs');
        if (!res.ok) throw new Error("接口异常");
        songs = await res.json();
        renderList();
        status.textContent = `✅ 已加载 ${songs.length} 首歌曲`;
        document.querySelectorAll('button').forEach(b => b.disabled = false);
    } catch (e) {
        status.textContent = '❌ 歌曲列表加载失败';
        list.innerHTML = '<div class="text-red-400 text-center py-4">加载失败，请刷新重试</div>';
    } finally {
        isLoadingSongs = false;
    }
}

// 渲染列表
function renderList() {
    list.innerHTML = '';
    if (songs.length === 0) {
        list.innerHTML = '<div class="text-gray-400 text-center py-6">暂无歌曲</div>';
        return;
    }
    songs.forEach((s, i) => {
        const d = document.createElement('div');
        d.className = 'song-item px-4 py-3 cursor-pointer rounded-xl border-b border-gray-700/50 hover:bg-gray-700/50 transition-all';
        d.innerHTML = `<span class="text-gray-400 mr-2">${i + 1}.</span>${s.path}`;
        d.onclick = () => play(i);
        list.appendChild(d);
    });
}

// 播放
function play(i) {
    if (songs.length === 0) return;
    idx = Math.max(0, Math.min(i, songs.length - 1));
    const song = songs[idx];

    p.pause();
    p.src = song.path;

    p.play().catch(err => {
        status.textContent = `❌ 无法播放：${song.path}`;
        setTimeout(next, 800);
    });

    document.querySelectorAll('.song-item').forEach((e, j) => {
        e.classList.toggle('bg-green-500/20', j === idx);
        e.classList.toggle('text-green-400', j === idx);
    });

    status.textContent = `▶️ 正在播放：${song.path}`;
    localStorage.setItem('last', idx);
}

// 关键：监听进度条拖拽，屏蔽中途误触发pause
p.addEventListener('seeking', () => {
    isSeeking = true;
});
p.addEventListener('seeked', () => {
    isSeeking = false;
});

// 只有不是拖拽进度条时，才更新暂停文案
p.onpause = () => {
    if (isSeeking) return;
    if (songs[idx]) status.textContent = `⏸️ 已暂停：${songs[idx].path}`;
};

p.onplay = () => {
    if (songs[idx]) status.textContent = `▶️ 正在播放：${songs[idx].path}`;
};

// 播放结束
p.onended = () => {
    loopMode === 'single' ? (p.currentTime = 0, p.play()) : next();
};

// 切歌
function prev() {
    if (songs.length === 0) return;
    const newIdx = loopMode === 'random' ? Math.floor(Math.random() * songs.length) : (idx - 1 + songs.length) % songs.length;
    play(newIdx);
}

function next() {
    if (songs.length === 0) return;
    const newIdx = loopMode === 'random' ? Math.floor(Math.random() * songs.length) : (idx + 1) % songs.length;
    play(newIdx);
}

// 循环模式
function toggleLoop() {
    if (loopMode === 'list') {
        loopMode = 'single';
        loopBtn.textContent = '🔂 单曲循环';
    } else if (loopMode === 'single') {
        loopMode = 'random';
        loopBtn.textContent = '🔀 随机播放';
    } else {
        loopMode = 'list';
        loopBtn.textContent = '🔁 列表循环';
    }
    p.loop = loopMode === 'single';
}

// 播放错误
p.onerror = () => {
    status.textContent = '❌ 播放失败，自动跳过下一曲';
    setTimeout(next, 600);
};

// 音量记忆
p.onvolumechange = () => {
    localStorage.setItem('volume', p.volume);
};