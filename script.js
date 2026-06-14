(function () {
    const CONFIG = {
        maxParticles: 250,
        particleSize: 7,
        fadeSpeed: 0.028,
        shrinkSpeed: 0.022,
        dragSpawnRate: 2,
        clickSpawnCount: 28,
        colors: ['#10b981', '#34d399', '#6ee7b7', '#059669', '#047857', '#4ade80', '#22c55e', '#a7f3d0']
    };

    let canvas, ctx, width, height;
    let particles = [];
    let lastX = null, lastY = null;
    let frameId = null;

    class Particle {
        constructor(x, y, vx, vy, color = null, size = null) {
            this.x = x;
            this.y = y;
            this.vx = vx || (Math.random() - 0.5) * 3.5;
            this.vy = vy || (Math.random() - 0.5) * 3 - 1.5;
            this.size = size || CONFIG.particleSize * (0.5 + Math.random() * 0.9);
            this.alpha = 0.9;
            this.color = color || CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
            this.life = 1;
            this.gravity = 0.06;
            this.drag = 0.98;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.vy += this.gravity;
            this.vx *= this.drag;
            this.vy *= this.drag;
            this.size -= CONFIG.shrinkSpeed;
            this.life -= CONFIG.fadeSpeed;
            this.alpha = this.life * 0.85;
            return this.life > 0.04 && this.size > 0.5;
        }

        draw(ctx) {
            ctx.save();
            ctx.globalAlpha = this.alpha;
            const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
            gradient.addColorStop(0, this.color);
            gradient.addColorStop(0.7, this.color + 'cc');
            gradient.addColorStop(1, this.color + '00');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size / 1.3, 0, Math.PI * 2);
            ctx.fill();
            if (this.size > 4 && this.life > 0.5) {
                ctx.beginPath();
                ctx.arc(this.x - 1, this.y - 1, this.size / 5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.fill();
            }
            ctx.restore();
        }
    }

    function limitParticles() {
        while (particles.length > CONFIG.maxParticles) particles.shift();
    }

    function createDragParticles(x, y) {
        let count = CONFIG.dragSpawnRate;
        if (lastX !== null && lastY !== null) {
            const dx = x - lastX, dy = y - lastY;
            const speed = Math.sqrt(dx * dx + dy * dy);
            count = Math.min(CONFIG.dragSpawnRate + Math.floor(speed / 5), 5);
        }
        for (let i = 0; i < count; i++) {
            let vx = (Math.random() - 0.5) * 2.2;
            let vy = (Math.random() - 0.5) * 2 - 0.8;
            if (lastX !== null && lastY !== null) {
                const dx = x - lastX, dy = y - lastY;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    const inertia = Math.min(len / 10, 2);
                    vx += (dx / len) * inertia;
                    vy += (dy / len) * inertia;
                }
            }
            particles.push(new Particle(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, vx, vy));
        }
        limitParticles();
        lastX = x;
        lastY = y;
    }

    function createClickParticles(x, y) {
        for (let i = 0; i < CONFIG.clickSpawnCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2.5 + Math.random() * 7;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed - 1;
            const color = CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
            const particle = new Particle(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, vx, vy, color, CONFIG.particleSize * (0.8 + Math.random() * 1.2));
            particle.drag = 0.96;
            particle.gravity = 0.1;
            particles.push(particle);
        }
        for (let i = 0; i < CONFIG.clickSpawnCount / 2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 4;
            particles.push(new Particle(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, Math.cos(angle) * speed, Math.sin(angle) * speed, '#ffffff', CONFIG.particleSize * 0.5));
        }
        limitParticles();
    }

    function animate() {
        if (!ctx) return;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(0, 0, width, height);
        const remaining = [];
        for (let p of particles) {
            if (p.update()) {
                p.draw(ctx);
                remaining.push(p);
            }
        }
        particles = remaining;
        frameId = requestAnimationFrame(animate);
    }

    function initCanvas() {
        canvas = document.getElementById('particle-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('mousemove', (e) => createDragParticles(e.clientX, e.clientY));
        window.addEventListener('click', (e) => createClickParticles(e.clientX, e.clientY));
        animate();
    }

    function resizeCanvas() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCanvas);
    } else {
        initCanvas();
    }
})();

// ============================================
// 音乐播放器核心逻辑
// ============================================
const p = document.getElementById("player");
const list = document.getElementById("list");
const statusDiv = document.getElementById("status");
const search = document.getElementById("search");
const loopBtn = document.getElementById("loop");

let songs = [];
let idx = 0;
let loopMode = "list";
let isLoadingSongs = false;
let isSeeking = false;
let errorCount = 0;
const MAX_ERROR = 2;

let playTimeout = null;
let stallTimeout = null;

let savedVol = parseFloat(localStorage.getItem("volume"));
p.volume = isNaN(savedVol) ? 0.7 : savedVol;

window.onload = () => {
    loadSongs();
    restoreLastSong();
};

function restoreLastSong() {
    const last = localStorage.getItem("last");
    if (last !== null && !isNaN(parseInt(last))) idx = parseInt(last);
}

document.addEventListener("keydown", (e) => {
    if (search === document.activeElement) return;
    if (e.code === "Space") {
        e.preventDefault();
        if (songs.length === 0) return;
        p.paused ? p.play() : p.pause();
    }
    if (e.code === "ArrowLeft" && songs.length > 0) prev();
    if (e.code === "ArrowRight" && songs.length > 0) next();
});

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

async function loadSongs() {
    if (isLoadingSongs) return;
    isLoadingSongs = true;
    const btns = document.querySelectorAll("button");
    btns.forEach(btn => btn.disabled = true);
    list.innerHTML = '<div class="text-gray-400 text-center py-8">🎵 加载歌曲列表中...</div>';
    statusDiv.textContent = "加载中...";

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
            statusDiv.textContent = `🎵 已加载 ${songs.length} 首歌曲`;
            success = true;
            btns.forEach(btn => btn.disabled = false);
            if (songs.length && idx >= songs.length) idx = 0;
            if (songs.length && !p.src) play(idx);
        } catch (e) {
            retries--;
            statusDiv.textContent = `加载失败，剩余重试：${retries}`;
            if (retries < 0) {
                statusDiv.textContent = "❌ 加载失败，请刷新页面";
                list.innerHTML = '<div class="text-red-400 text-center py-6">加载失败，请检查网络</div>';
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
        div.className = "song-item px-4 py-3 cursor-pointer rounded-xl border-b border-gray-700/50 transition-all";
        div.innerHTML = `<span class="text-gray-400 mr-2">${i + 1}.</span>${escapeHtml(path)}`;
        div.onclick = () => play(i);
        list.appendChild(div);
    });
}

function highlightCurrentSong() {
    document.querySelectorAll(".song-item").forEach((el, j) => {
        el.classList.toggle("bg-green-500/20", j === idx);
        el.classList.toggle("text-green-400", j === idx);
        el.classList.toggle("border-green-500/30", j === idx);
    });
}

function play(i) {
    if (songs.length === 0) return;
    const newIdx = Math.max(0, Math.min(i, songs.length - 1));
    if (newIdx !== idx) errorCount = 0;
    idx = newIdx;
    const path = songs[idx];
    clearPlayTimeouts();
    p.pause();
    p.src = path;
    p.load();
    playTimeout = setTimeout(() => {
        if (p.readyState < 2) handlePlayError(new Error("加载超时"));
    }, 5000);
    p.play().catch(err => {
        if (err.name === "NotAllowedError") {
            clearPlayTimeouts();
            statusDiv.textContent = "▶️ 请手动点击页面后播放";
        } else {
            handlePlayError(err);
        }
    });
    p.addEventListener("stalled", onStalled);
    p.addEventListener("playing", onPlaying);
    highlightCurrentSong();
    statusDiv.textContent = `🔄 正在加载：${path}`;
    localStorage.setItem("last", idx);
}

function handlePlayError(err) {
    clearPlayTimeouts();
    errorCount++;
    const path = songs[idx] || "未知歌曲";
    statusDiv.textContent = `⚠️ 播放失败 (${errorCount}/${MAX_ERROR})：${path}`;
    console.warn("播放错误:", err);
    if (errorCount >= MAX_ERROR) {
        p.pause();
        statusDiv.textContent = "⏹️ 连续失败，已停止播放";
        errorCount = 0;
    } else {
        setTimeout(() => {
            if (errorCount < MAX_ERROR && songs[idx]) {
                p.load();
                p.play().catch(() => { });
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
        if (p.readyState < 2 && !p.ended && !p.paused) handlePlayError(new Error("下载停滞"));
    }, 10000);
}

function onPlaying() {
    clearPlayTimeouts();
    errorCount = 0;
    if (songs[idx]) statusDiv.textContent = `🎶 正在播放：${songs[idx]}`;
}

p.addEventListener("seeking", () => isSeeking = true);
p.addEventListener("seeked", () => isSeeking = false);
p.addEventListener("pause", () => {
    if (!isSeeking && songs[idx]) statusDiv.textContent = `⏸️ 已暂停：${songs[idx]}`;
});
p.addEventListener("ended", () => {
    if (loopMode === "single") {
        p.currentTime = 0;
        p.play().catch(e => handlePlayError(e));
    } else {
        next();
    }
});
p.addEventListener("volumechange", () => localStorage.setItem("volume", p.volume));
p.addEventListener("error", (e) => {
    if (p.error && (p.error.code === MediaError.MEDIA_ERR_NETWORK ||
        p.error.code === MediaError.MEDIA_ERR_DECODE ||
        p.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
        handlePlayError(p.error);
    }
});

function prev() {
    if (songs.length === 0) return;
    let newIdx;
    if (loopMode === "random") newIdx = Math.floor(Math.random() * songs.length);
    else newIdx = (idx - 1 + songs.length) % songs.length;
    play(newIdx);
}

function next() {
    if (songs.length === 0) return;
    let newIdx;
    if (loopMode === "random") newIdx = Math.floor(Math.random() * songs.length);
    else newIdx = (idx + 1) % songs.length;
    play(newIdx);
}

function toggleLoop() {
    if (loopMode === "list") { loopMode = "single"; loopBtn.textContent = "🔂 单曲循环"; }
    else if (loopMode === "single") { loopMode = "random"; loopBtn.textContent = "🎲 随机播放"; }
    else { loopMode = "list"; loopBtn.textContent = "🔁 列表循环"; }
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightLine(num, fullPath, kw) {
    const safeKw = escapeRegex(kw);
    const reg = new RegExp(`(${safeKw})`, "gi");
    const lastSlash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
    let dirPart = "", filePart = fullPath;
    if (lastSlash > -1) { dirPart = fullPath.substring(0, lastSlash + 1); filePart = fullPath.substring(lastSlash + 1); }
    const highlightDir = dirPart.replace(reg, '<span class="text-green-400 font-semibold">$1</span>');
    const highlightFile = filePart.replace(reg, '<span class="text-yellow-400 font-semibold">$1</span>');
    return `<span class="text-gray-400 mr-2">${num}.</span>${highlightDir}${highlightFile}`;
}

window.play = play;
window.prev = prev;
window.next = next;
window.toggleLoop = toggleLoop;
window.loadSongs = loadSongs;