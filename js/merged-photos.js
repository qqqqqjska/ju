/*!
 * merged-photos.js — 微信"合并照片"聊天消息
 * 折叠态：PhotoStack 堆叠卡（堆叠 / 探边 / 跟手翻页）
 * 展开态：卡片飞散成竖直消息流（双时间轴 FLIP + 头像编排 + 滚动编排）
 *
 * 依赖：PhotoStack（photo-stack.js）、window.resolveChatMediaSrc（可选，解析延迟媒体引用）
 * 展开/收起动画规格参考 Wren036/PhotoStack README 的逆向工程笔记，在宿主聊天布局中重建。
 */
(function () {
    'use strict';

    // 折叠堆叠卡的舞台尺寸（微信固定 3:4）
    const STACK_W = 140;
    const STACK_H = 186;

    // 展开后每张照片的最大宽度
    const PHOTO_MAX_W = 150;

    // 动画时长（README：横向共用一条短曲线，纵向按序号错落）
    const H_DUR = 280;          // 横向（位移/缩放/旋转）共用时长
    const V_STEP = 45;          // 纵向每张递增时长
    const AVATAR_FADE = 220;

    /* ── 缓动 ── */
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInCubic(t) { return t * t * t; }

    /* ── content 解析：JSON 数组（媒体引用或 dataURL）── */
    function parseList(text) {
        if (Array.isArray(text)) return text.slice();
        if (typeof text !== 'string') return [];
        try {
            const a = JSON.parse(text);
            return Array.isArray(a) ? a : (text ? [text] : []);
        } catch (e) {
            return text ? [text] : [];
        }
    }

    /* ── 序列化：把一组媒体引用打包成 merged_photos 消息内容 ── */
    window.buildMergedPhotosContent = function (refs) {
        return JSON.stringify(Array.isArray(refs) ? refs : []);
    };

    /* ── appendMessageToUI 调用：生成消息内容占位（真正的堆叠卡在 init 时挂载）── */
    window.buildMergedPhotosMarkup = function (text) {
        const list = parseList(text);
        const encoded = encodeURIComponent(JSON.stringify(list));
        // 占位骨架：一个与堆叠卡等大的方块，避免解析图片前的布局跳动
        return `<div class="mp-root" data-mp="${encoded}" data-mp-count="${list.length}">`
            + `<div class="mp-skeleton" style="width:${STACK_W}px;height:${STACK_H}px;"></div>`
            + `</div>`;
    };

    /* ── 把媒体引用逐个解析成可用 src ── */
    async function resolveAll(list) {
        const out = [];
        for (const ref of list) {
            let src = ref;
            if (typeof window.isChatMediaReference === 'function' && window.isChatMediaReference(ref)) {
                try {
                    src = await window.resolveChatMediaSrc(ref);
                    if (!src && typeof window.resolveChatMediaDataUrl === 'function') {
                        src = await window.resolveChatMediaDataUrl(ref);
                    }
                } catch (e) { src = ''; }
            }
            out.push(src || '');
        }
        return out;
    }

    /* ── 入口：初始化一个消息节点里的合并照片 ── */
    window.initMergedPhotosMessage = function (msgDiv) {
        if (!msgDiv) return;
        const root = msgDiv.querySelector('.mp-root');
        if (!root || root.dataset.mpInit === '1') return;
        root.dataset.mpInit = '1';
        let list = [];
        try { list = JSON.parse(decodeURIComponent(root.dataset.mp || '[]')); } catch (e) { list = []; }
        if (!list.length) return;
        resolveAll(list).then(srcs => {
            srcs = srcs.filter(Boolean);
            if (!srcs.length) return;
            build(msgDiv, root, srcs);
        });
    };

    /* ── 构建折叠堆叠卡 + 隐藏的展开流 ── */
    function build(msgDiv, root, srcs) {
        root.innerHTML = '';
        const isUser = msgDiv.classList.contains('user');
        const avatarSrc = (() => {
            const a = msgDiv.querySelector('.chat-avatar');
            return a ? a.getAttribute('src') || '' : '';
        })();

        // —— 折叠态："展开 N"（左） + 堆叠卡（右）——
        const collapsed = document.createElement('div');
        collapsed.className = 'mp-collapsed';
        const stageHost = document.createElement('div');
        stageHost.className = 'mp-stage-host';
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'mp-pill';
        pill.textContent = '展开 ' + srcs.length;
        collapsed.appendChild(pill);       // 按钮在图片左边
        collapsed.appendChild(stageHost);
        root.appendChild(collapsed);

        // —— 展开态：竖直照片流（每行 头像+照片）——
        const flow = document.createElement('div');
        flow.className = 'mp-flow';
        flow.hidden = true;
        const rows = srcs.map((s, i) => {
            const row = document.createElement('div');
            row.className = 'mp-row';
            const av = document.createElement('img');
            av.className = 'mp-row-avatar';
            av.src = avatarSrc;
            const shell = document.createElement('div');
            shell.className = 'mp-photo';
            const im = document.createElement('img');
            im.className = 'mp-photo-img';
            im.src = s;
            im.loading = 'lazy';
            im.decoding = 'async';
            im.addEventListener('click', () => openViewer(srcs, i));
            shell.appendChild(im);
            // 统一 头像→照片 顺序，左右由 CSS flex-direction 控制（他人 row / 自己 row-reverse）
            row.appendChild(av);
            row.appendChild(shell);
            flow.appendChild(row);
            return { row, av, shell, img: im };
        });
        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.className = 'mp-pill mp-collapse-pill';
        collapseBtn.textContent = '收起';
        flow.appendChild(collapseBtn);
        root.appendChild(flow);

        // 堆叠卡实例
        const ps = new PhotoStack(stageHost, srcs, {
            width: STACK_W, height: STACK_H,
            flingVel: 0.25,                       // 降低快甩阈值，轻甩即可翻页
            onTap: (i) => openViewer(srcs, i)
        });
        // 在可滚动的聊天里让堆叠卡独占横向手势：否则浏览器可能把横滑判成纵向滚动并
        // 发出 pointercancel，导致松手回弹翻不动（touch-action:none 交给组件全权处理）
        const stageEl = stageHost.querySelector('.pstack-stage');
        if (stageEl) stageEl.style.touchAction = 'none';
        // 缩短翻页行程分母：原版按"起点到屏幕边"的距离，右侧气泡里过长，小卡片很难翻过阈值。
        // 固定为 140px → 拖过约 70px（半程）即可翻页。
        ps._progress = function (dx) { return Math.min(1, Math.abs(dx) / 140); };

        const ctx = { msgDiv, root, collapsed, flow, rows, srcs, ps, isUser, animating: false, expanded: false };
        pill.addEventListener('click', () => expand(ctx));
        collapseBtn.addEventListener('click', () => collapse(ctx));
    }

    /* ── 聊天滚动容器 ── */
    function scrollContainer() {
        return document.getElementById('chat-messages');
    }

    function rectOf(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    const MP_EASE = 'cubic-bezier(.22, .68, .34, 1)';

    /* ── 展开：容器高度平滑增长 + 各行错落淡入（下方内容自然被推开，无留白/跳变）── */
    function expand(ctx) {
        if (ctx.animating || ctx.expanded) return;
        ctx.animating = true;
        ctx.expanded = true;

        const flow = ctx.flow;
        const n = ctx.rows.length;
        const DUR = 340, STAGGER = 40;

        ctx.msgDiv.classList.add('mp-expanded');

        // 展开流参与布局并测出目标高度
        flow.hidden = false;
        flow.style.opacity = '1';
        flow.style.overflow = 'hidden';
        flow.style.transition = 'none';
        flow.style.height = 'auto';
        const full = flow.offsetHeight;
        flow.style.height = '0px';
        flow.offsetHeight;                       // 强制 reflow，把 0 作为动画起点

        // 各行入场初态（transform/opacity 不影响已测高度）
        ctx.rows.forEach(r => {
            r.shell.style.visibility = '';
            r.row.style.transition = 'none';
            r.row.style.opacity = '0';
            r.row.style.transform = 'translateY(10px) scale(.97)';
            r.av.style.opacity = '0';
        });

        // 折叠卡快速淡出并让位
        ctx.collapsed.style.transition = 'opacity .16s ease';
        ctx.collapsed.style.opacity = '0';
        setTimeout(() => { ctx.collapsed.hidden = true; }, 170);

        const total = DUR + (n - 1) * STAGGER;
        requestAnimationFrame(() => {
            flow.style.transition = `height ${total}ms ${MP_EASE}`;
            flow.style.height = full + 'px';
            ctx.rows.forEach((r, i) => {
                const delay = i * STAGGER;
                r.row.style.transition = `opacity 220ms ease ${delay}ms, transform ${DUR}ms ${MP_EASE} ${delay}ms`;
                r.row.style.opacity = '1';
                r.row.style.transform = 'none';
                fadeAvatar(r.av, i, false);
            });
        });

        let ended = false;
        const onEnd = (e) => {
            if (ended) return;
            if (e && (e.target !== flow || e.propertyName !== 'height')) return;
            ended = true;
            flow.removeEventListener('transitionend', onEnd);
            flow.style.transition = '';
            flow.style.height = 'auto';
            flow.style.overflow = '';
            ctx.animating = false;
        };
        flow.addEventListener('transitionend', onEnd);
        setTimeout(() => onEnd(), total + 180);
    }

    /* ── 收起：容器高度平滑收缩 + 各行反向错落退场 ── */
    function collapse(ctx) {
        if (ctx.animating || !ctx.expanded) return;
        ctx.animating = true;
        ctx.expanded = false;

        const flow = ctx.flow;
        const n = ctx.rows.length;
        const DUR = 300, STAGGER = 34;

        // 锁定当前高度作为收缩起点
        flow.style.overflow = 'hidden';
        flow.style.transition = 'none';
        flow.style.height = flow.offsetHeight + 'px';
        flow.offsetHeight;                       // reflow

        // 折叠卡就位并淡入
        ctx.collapsed.hidden = false;
        ctx.collapsed.style.transition = 'none';
        ctx.collapsed.style.opacity = '0';

        // 各行反向错落退场
        ctx.rows.forEach((r, i) => {
            const delay = (n - 1 - i) * STAGGER;
            r.row.style.transition = `opacity 180ms ease ${delay}ms, transform ${DUR}ms ${MP_EASE} ${delay}ms`;
            r.row.style.opacity = '0';
            r.row.style.transform = 'translateY(8px) scale(.97)';
            fadeAvatar(r.av, i, true);
        });

        const total = DUR + (n - 1) * STAGGER;
        requestAnimationFrame(() => {
            ctx.collapsed.style.transition = 'opacity .22s ease .06s';
            ctx.collapsed.style.opacity = '1';
            flow.style.transition = `height ${total}ms ${MP_EASE}`;
            flow.style.height = '0px';
        });

        let ended = false;
        const onEnd = (e) => {
            if (ended) return;
            if (e && (e.target !== flow || e.propertyName !== 'height')) return;
            ended = true;
            flow.removeEventListener('transitionend', onEnd);
            finishCollapse(ctx);
        };
        flow.addEventListener('transitionend', onEnd);
        setTimeout(() => onEnd(), total + 180);
    }

    function finishCollapse(ctx) {
        ctx.flow.hidden = true;
        ctx.flow.style.transition = '';
        ctx.flow.style.height = '';
        ctx.flow.style.overflow = '';
        ctx.flow.style.opacity = '';
        ctx.rows.forEach(r => {
            r.shell.style.visibility = '';
            r.row.style.transition = '';
            r.row.style.transform = '';
            r.row.style.opacity = '';
            r.av.style.opacity = '0';
        });
        ctx.msgDiv.classList.remove('mp-expanded');
        ctx.animating = false;
    }

    /* ── 头像淡入/淡出（错落）── */
    function fadeAvatar(av, i, out) {
        const delay = out ? 0 : (60 + i * 40);
        setTimeout(() => {
            av.style.transition = `opacity ${AVATAR_FADE}ms ease`;
            av.style.opacity = out ? '0' : '1';
        }, delay);
    }

    /* ── 滚动编排：展开变高后，若内容落到下边缘外，平滑跟随（rAF 补间）── */
    function keepVisibleAfterGrow(ctx, cont, beforeScrollTop) {
        if (!cont) return;
        requestAnimationFrame(() => {
            const flowRect = rectOf(ctx.flow);
            const contRect = rectOf(cont);
            const overflowBottom = flowRect.bottom - contRect.bottom;
            if (overflowBottom > 0) {
                const target = cont.scrollTop + overflowBottom + 12;
                smoothScrollTo(cont, target, 320);
            }
        });
    }

    function smoothScrollTo(el, target, dur) {
        const start = el.scrollTop;
        const max = el.scrollHeight - el.clientHeight;
        const dest = Math.max(0, Math.min(max, target));
        const t0 = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - t0) / dur);
            el.scrollTop = start + (dest - start) * easeOutCubic(t);
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    /* ── 全屏大图查看器（左右滑动切换，轻点关闭）── */
    let viewer = null, vList = [], vIdx = 0, vSx = null, vNum = null, vImg = null;
    function ensureViewer() {
        if (viewer) return;
        viewer = document.createElement('div');
        viewer.className = 'mp-viewer';
        vImg = document.createElement('img');
        vImg.className = 'mp-viewer-img';
        vNum = document.createElement('div');
        vNum.className = 'mp-viewer-num';
        viewer.appendChild(vImg);
        viewer.appendChild(vNum);
        document.body.appendChild(viewer);
        viewer.addEventListener('pointerdown', e => { vSx = e.clientX; });
        viewer.addEventListener('pointerup', e => {
            if (vSx === null) return;
            const dx = e.clientX - vSx; vSx = null;
            if (Math.abs(dx) > 40) {
                const ni = vIdx + (dx < 0 ? 1 : -1);
                if (ni >= 0 && ni < vList.length) { vIdx = ni; vRender(); }
            } else {
                viewer.classList.remove('show');
            }
        });
    }
    function vRender() {
        vImg.src = vList[vIdx];
        vNum.textContent = (vIdx + 1) + ' / ' + vList.length;
    }
    function openViewer(list, i) {
        ensureViewer();
        vList = list; vIdx = i; vRender();
        viewer.classList.add('show');
    }

    /* ── 提供给发送端：把多文件存成引用后拿到内容字符串（供 04-media-init 使用）── */
    // 实际存储在 handleChatPhotoUpload 中完成，这里只提供打包函数（见上 buildMergedPhotosContent）
})();
