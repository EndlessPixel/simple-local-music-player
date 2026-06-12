const p = document.getElementById("player");
const list = document.getElementById("list");
const status = document.getElementById("status");
const search = document.getElementById("search");
const loopBtn = document.getElementById("loop");

let songs = [];
let idx = 0;
let loopMode = "list";           // list / single / random
let isLoadingSongs = false;
let isSeeking = false;
let errorCount = 0;
const MAX_ERROR = 2;

// 超时与停滞检测相关
let playTimeout = null;
let stallTimeout = null;

// 音量读取
let savedVol = parseFloat(localStorage.getItem("volume"));
p.volume = isNaN(savedVol) ? 0.7 : savedVol;

// 初始化
window.onload = () => {
    loadSongs();
    restoreLastSong();
};

function restoreLastSong() {
    const last = localStorage.getItem("last");
    if (last !== null && !isNaN(parseInt(last))) {
        idx = parseInt(last);
    }
}

// 键盘控制
document.addEventListener("keydown", (e) => {
    if (search === document.activeElement) return;
    if (e.code === "Space") {
        e.preventDefault();
        if (songs.length === 0) return;
        p.paused ? p.play() : p.pause();
    }
    if (e.code === "ArrowLeft") {
        if (songs.length > 0) prev();
    }
    if (e.code === "ArrowRight") {
        if (songs.length > 0) next();
    }
});

// 搜索高亮
search.oninput = () => {
    const kw = search.value.trim().toLowerCase();
    document.querySelectorAll(".song-item").forEach((el, i) => {
        const fullPath = songs[i] || "";
        const numStr = String(i + 1);
        const match = !kw || numStr.includes(kw) || fullPath.toLowerCase().includes(kw);
        el.hidden = !match;
        if (kw && match) {
            el.innerHTML = renderHighlightLine(i + 1, fullPath, kw);
        } else if (!kw) {
            el.innerHTML = `<span class="text-gray-400 mr-2">${i + 1}.</span>${escapeHtml(fullPath)}`;
        }
    });
    highlightCurrentSong();
};

// 加载歌曲列表
async function loadSongs() {
    if (isLoadingSongs) return;
    isLoadingSongs = true;
    const btns = document.querySelectorAll("button");
    btns.forEach(btn => btn.disabled = true);
    list.innerHTML = '<div class="text-gray-400 text-center py-4">加载歌曲列表...</div>';
    status.textContent = "加载中...";

    let retries = 2;
    let success = false;
    while (retries >= 0 && !success) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 8000);
            const res = await fetch("/api/songs", { signal: controller.signal });
            clearTimeout(id);
            if (!res.ok) throw new Error("接口异常");
            const dirMap = await res.json();
            songs = [];
            for (const [dir, files] of Object.entries(dirMap)) {
                for (const file of files) {
                    songs.push(dir === "." ? file : dir + "/" + file);
                }
            }
            renderList();
            if (search.value.trim()) search.oninput();
            highlightCurrentSong();
            status.textContent = `已加载 ${songs.length} 首歌曲`;
            success = true;
            btns.forEach(btn => btn.disabled = false);
            // 恢复上次播放的歌曲（如果存在）
            if (songs.length && idx >= songs.length) idx = 0;
            if (songs.length && !p.src) play(idx);
        } catch (e) {
            retries--;
            status.textContent = `加载失败，剩余重试：${retries}`;
            if (retries < 0) {
                status.textContent = "加载失败，请刷新页面";
                list.innerHTML = '<div class="text-red-400 text-center py-4">加载失败</div>';
                btns.forEach(btn => btn.disabled = true);
            }
        }
    }
    isLoadingSongs = false;
}

function renderList() {
    list.innerHTML = "";
    if (songs.length === 0) {
        list.innerHTML = '<div class="text-gray-400 text-center py-6">暂无歌曲</div>';
        return;
    }
    songs.forEach((path, i) => {
        const div = document.createElement("div");
        div.className = "song-item px-4 py-3 cursor-pointer rounded-xl border-b border-gray-700/50 hover:bg-gray-700/50 transition-all";
        div.innerHTML = `<span class="text-gray-400 mr-2">${i + 1}.</span>${escapeHtml(path)}`;
        div.onclick = () => play(i);
        list.appendChild(div);
    });
}

function highlightCurrentSong() {
    document.querySelectorAll(".song-item").forEach((el, j) => {
        el.classList.toggle("bg-green-500/20", j === idx);
        el.classList.toggle("text-green-400", j === idx);
    });
}

// ========== 核心播放逻辑 ==========
function play(i) {
    if (songs.length === 0) return;
    const newIdx = Math.max(0, Math.min(i, songs.length - 1));
    // 只有切换到不同歌曲时才重置错误计数（用户主动切歌）
    if (newIdx !== idx) errorCount = 0;
    idx = newIdx;
    const path = songs[idx];

    // 清理之前的超时/停滞定时器
    clearPlayTimeouts();

    // 先暂停、取消当前请求
    p.pause();
    p.src = path;
    p.load();

    // 设置播放超时检测（5秒内必须开始播放）
    playTimeout = setTimeout(() => {
        if (p.readyState < 2) { // HAVE_CURRENT_DATA 以下
            handlePlayError(new Error("加载超时"));
        }
    }, 5000);

    // 播放 Promise
    p.play().catch(err => {
        // 仅当是用户交互策略错误时提示，其它交给 handlePlayError
        if (err.name === "NotAllowedError") {
            clearPlayTimeouts();
            status.textContent = "请手动点击页面后播放";
        } else {
            handlePlayError(err);
        }
    });

    // 停滞检测（下载卡住）
    p.addEventListener("stalled", onStalled);
    p.addEventListener("playing", onPlaying);

    highlightCurrentSong();
    status.textContent = `正在加载：${path}`;
    localStorage.setItem("last", idx);
}

function handlePlayError(err) {
    clearPlayTimeouts();
    errorCount++;
    const path = songs[idx] || "未知歌曲";
    status.textContent = `播放失败 (${errorCount}/${MAX_ERROR})：${path}`;
    console.warn("播放错误:", err, p.error);

    if (errorCount >= MAX_ERROR) {
        p.pause();
        status.textContent = "连续失败，已停止播放";
        errorCount = 0;  // 停止后重置，允许手动重试
        // 可选：显示重试按钮或保持静止
    } else {
        // 延迟重试当前同一首歌（不清零 errorCount）
        setTimeout(() => {
            if (errorCount < MAX_ERROR && songs[idx]) {
                p.load();
                p.play().catch(() => {});
            }
        }, 1000);
    }
}

function clearPlayTimeouts() {
    if (playTimeout) clearTimeout(playTimeout);
    if (stallTimeout) clearTimeout(stallTimeout);
    p.removeEventListener("stalled", onStalled);
    p.removeEventListener("playing", onPlaying);
}

function onStalled() {
    stallTimeout = setTimeout(() => {
        if (p.readyState < 2 && !p.ended && !p.paused) {
            handlePlayError(new Error("下载停滞"));
        }
    }, 10000);
}

function onPlaying() {
    clearPlayTimeouts();
    errorCount = 0;      // 成功播放，清除错误计数
    if (songs[idx]) status.textContent = `正在播放：${songs[idx]}`;
}

// 播放器事件
p.addEventListener("seeking", () => isSeeking = true);
p.addEventListener("seeked", () => isSeeking = false);
p.addEventListener("pause", () => {
    if (!isSeeking && songs[idx]) status.textContent = `已暂停：${songs[idx]}`;
});
p.addEventListener("ended", () => {
    if (loopMode === "single") {
        p.currentTime = 0;
        p.play().catch(e => handlePlayError(e));
    } else {
        next();
    }
});
p.addEventListener("volumechange", () => {
    localStorage.setItem("volume", p.volume);
});
// 媒体错误统一处理（网络/解码/格式错误）
p.addEventListener("error", (e) => {
    // 避免重复处理（已经在 handlePlayError 里统一）
    if (p.error && (p.error.code === MediaError.MEDIA_ERR_NETWORK ||
                    p.error.code === MediaError.MEDIA_ERR_DECODE ||
                    p.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
        handlePlayError(p.error);
    }
});

// ========== 控制函数 ==========
function prev() {
    if (songs.length === 0) return;
    // 不再在 prev/next 中重置 errorCount
    let newIdx;
    if (loopMode === "random") {
        newIdx = Math.floor(Math.random() * songs.length);
    } else {
        newIdx = (idx - 1 + songs.length) % songs.length;
    }
    play(newIdx);
}

function next() {
    if (songs.length === 0) return;
    let newIdx;
    if (loopMode === "random") {
        newIdx = Math.floor(Math.random() * songs.length);
    } else {
        newIdx = (idx + 1) % songs.length;
    }
    play(newIdx);
}

function toggleLoop() {
    if (loopMode === "list") {
        loopMode = "single";
        loopBtn.textContent = "单曲循环";
    } else if (loopMode === "single") {
        loopMode = "random";
        loopBtn.textContent = "随机播放";
    } else {
        loopMode = "list";
        loopBtn.textContent = "列表循环";
    }
    // 移除 p.loop 设置，完全由 onended 控制
}

// 辅助函数
function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
        return c;
    });
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightLine(num, fullPath, kw) {
    const safeKw = escapeRegex(kw);
    const reg = new RegExp(`(${safeKw})`, "gi");
    const lastSlash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
    let dirPart = "", filePart = fullPath;
    if (lastSlash > -1) {
        dirPart = fullPath.substring(0, lastSlash + 1);
        filePart = fullPath.substring(lastSlash + 1);
    }
    const highlightDir = dirPart.replace(reg, '<span class="text-green-400 font-semibold">$1</span>');
    const highlightFile = filePart.replace(reg, '<span class="text-yellow-400 font-semibold">$1</span>');
    return `<span class="text-gray-400 mr-2">${num}.</span>${highlightDir}${highlightFile}`;
}

// 暴露必要的全局函数（供 HTML 内联调用，如 onclick）
window.play = play;
window.prev = prev;
window.next = next;
window.toggleLoop = toggleLoop;