const p = document.getElementById('player');
const list = document.getElementById('list');
const status = document.getElementById('status');
const search = document.getElementById('search');
const loopBtn = document.getElementById('loop');

let songs = [], idx = 0, loopMode = 'list';
let isLoadingSongs = false;
let isSeeking = false;

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

// 搜索：支持序号 + 完整文件夹路径 + 文件名匹配
search.oninput = () => {
    const kw = search.value.trim().toLowerCase();
    document.querySelectorAll('.song-item').forEach((el, i) => {
        const fullPath = songs[i] || '';
        const numStr = String(i + 1);
        const fullPathLower = fullPath.toLowerCase();
        
        // 匹配：序号 / 完整路径(含文件夹) / 文件名
        const match = !kw || numStr.includes(kw) || fullPathLower.includes(kw);

        el.hidden = !match;
        // 有关键词则分路径/文件双色高亮，无关键词显示原样
        el.innerHTML = kw 
            ? renderHighlightLine(i + 1, fullPath, kw)
            : `<span class="text-gray-400 mr-2">${i + 1}.</span>${fullPath}`;
    });

    // 搜索后保持当前播放高亮
    highlightCurrentSong();
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
        
        // 渲染列表
        renderList();
        
        // 刷新后自动重新执行搜索
        if (search.value.trim()) {
            search.oninput();
        }
        
        // 刷新后自动高亮当前播放歌曲
        highlightCurrentSong();

        status.textContent = `✅ 已加载 ${songs.length} 首歌曲`;
        document.querySelectorAll('button').forEach(b => b.disabled = false);
    } catch (e) {
        status.textContent = '❌ 歌曲列表加载失败';
        list.innerHTML = '<div class="text-red-400 text-center py-4">加载失败，请刷新重试</div>';
    } finally {
        isLoadingSongs = false;
    }
}

// 渲染列表：完整路径原样显示
function renderList() {
    list.innerHTML = '';
    if (songs.length === 0) {
        list.innerHTML = '<div class="text-gray-400 text-center py-6">暂无歌曲</div>';
        return;
    }
    songs.forEach((path, i) => {
        const d = document.createElement('div');
        d.className = 'song-item px-4 py-3 cursor-pointer rounded-xl border-b border-gray-700/50 hover:bg-gray-700/50 transition-all';
        d.innerHTML = `<span class="text-gray-400 mr-2">${i + 1}.</span>${path}`;
        d.onclick = () => play(i);
        list.appendChild(d);
    });
}

// 高亮当前播放歌曲
function highlightCurrentSong() {
    document.querySelectorAll('.song-item').forEach((e, j) => {
        e.classList.toggle('bg-green-500/20', j === idx);
        e.classList.toggle('text-green-400', j === idx);
    });
}

// 播放
function play(i) {
    if (songs.length === 0) return;
    idx = Math.max(0, Math.min(i, songs.length - 1));
    const path = songs[idx];

    p.pause();
    p.src = path;

    p.load(); // ✅ 关键修复！让进度条正常工作

    p.play().catch(err => {
        status.textContent = `❌ 无法播放：${path}`;
        setTimeout(next, 800);
    });

    highlightCurrentSong();
    status.textContent = `▶️ 正在播放：${path}`;
    localStorage.setItem('last', idx);
}

// 进度条拖拽标记
p.addEventListener('seeking', () => {
    isSeeking = true;
});
p.addEventListener('seeked', () => {
    isSeeking = false;
});

// 暂停状态
p.onpause = () => {
    if (isSeeking) return;
    if (songs[idx]) status.textContent = `⏸️ 已暂停：${songs[idx]}`;
};

// 播放状态
p.onplay = () => {
    if (songs[idx]) status.textContent = `▶️ 正在播放：${songs[idx]}`;
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

// 工具：截取文件名
function getFileName(path) {
    if (!path) return '';
    return path.split('/').pop().split('\\').pop();
}

// 工具：文件夹关键词绿色高亮，文件名关键词黄色高亮
function renderHighlightLine(num, fullPath, kw) {
    const reg = new RegExp(`(${kw})`, 'gi');
    const lastSlash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
    
    let dirPart = '';
    let filePart = fullPath;

    if (lastSlash > -1) {
        dirPart = fullPath.substring(0, lastSlash + 1);
        filePart = fullPath.substring(lastSlash + 1);
    }

    // 文件夹路径：绿色高亮
    const highlightDir = dirPart.replace(reg, '<span class="text-green-400 font-semibold">$1</span>');
    // 文件名：黄色高亮
    const highlightFile = filePart.replace(reg, '<span class="text-yellow-400 font-semibold">$1</span>');

    return `<span class="text-gray-400 mr-2">${num}.</span>${highlightDir}${highlightFile}`;
}