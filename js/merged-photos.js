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
    const STACK_W = 116;
    const STACK_H = 154;

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
            onTap: (i) => openViewer(srcs, i)
        });

        const ctx = { msgDiv, root, collapsed, flow, rows, srcs, ps, isUser, animating: false, expanded: false };
        pill.addEventListener('click', () => expand(ctx));
        collapseBtn.addEventListener('click', () => collapse(ctx));
    }

    /* ── 聊天滚动容器 ── */
    function scrollContainer() {
        return document.getElementById('chat-messages');
    }

    /* ── 飞行替身：定位在目标处，用 transform 映射回堆叠位再过渡（FLIP，走合成器，丝滑）── */
    function makeFlyer(src, to) {
        const el = document.createElement('img');
        el.src = src;
        el.className = 'mp-flyer';
        el.style.left = to.x + 'px';
        el.style.top = to.y + 'px';
        el.style.width = to.w + 'px';
        el.style.height = to.h + 'px';
        el.style.transformOrigin = '0 0';
        document.body.appendChild(el);
        return el;
    }

    // 把 to 矩形映射到 from 矩形的 transform（transform-origin:0 0）
    function mapTransform(from, to, rot) {
        const sx = from.w / (to.w || 1);
        const sy = from.h / (to.h || 1);
        return `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${sx}, ${sy})` + (rot ? ` rotate(${rot}deg)` : '');
    }

    const FLIGHT_EASE = 'cubic-bezier(.22, .68, .34, 1)';

    function rectOf(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    // 起飞扇形角：模拟从扇状堆叠中飞出
    function fanAngle(i, n) {
        const c = (n - 1) / 2;
        return Math.max(-8, Math.min(8, (i - c) * 2.6));
    }

    /* ── 展开（FLIP + CSS 过渡）── */
    function expand(ctx) {
        if (ctx.animating || ctx.expanded) return;
        ctx.animating = true;
        ctx.expanded = true;

        const stageRect = rectOf(ctx.collapsed.querySelector('.mp-stage-host'));
        const cont = scrollContainer();

        // 展开流参与布局，用于测量各行照片落点
        ctx.flow.hidden = false;
        ctx.flow.classList.add('mp-measuring');
        ctx.msgDiv.classList.add('mp-expanded');

        requestAnimationFrame(() => {
            const targets = ctx.rows.map(r => rectOf(r.shell));

            ctx.collapsed.style.transition = 'opacity .2s ease';
            ctx.collapsed.style.opacity = '0';
            ctx.flow.classList.remove('mp-measuring');
            ctx.flow.style.opacity = '1';

            const n = ctx.srcs.length;
            const DUR = 380, STAGGER = 42;
            let done = 0;
            const finishAll = () => { if (++done >= n) ctx.animating = false; };

            ctx.rows.forEach((r, i) => {
                r.shell.style.visibility = 'hidden';   // 飞行期间由替身表现
                r.av.style.opacity = '0';
                const to = targets[i];
                const flyer = makeFlyer(ctx.srcs[i], to);
                flyer.style.transform = mapTransform(stageRect, to, fanAngle(i, n));   // 起飞姿态＝堆叠位
                flyer.getBoundingClientRect();                                          // 强制 reflow 锁定起点
                const delay = i * STAGGER;
                flyer.style.transition = `transform ${DUR}ms ${FLIGHT_EASE} ${delay}ms`;
                flyer.style.transform = 'translate(0,0) scale(1,1) rotate(0deg)';       // 过渡到落位
                let ended = false;
                const finish = () => {
                    if (ended) return; ended = true;
                    r.shell.style.visibility = '';
                    flyer.remove();
                    finishAll();
                };
                flyer.addEventListener('transitionend', finish, { once: true });
                setTimeout(finish, DUR + delay + 140);   // 兜底
                fadeAvatar(r.av, i, false);
            });

            setTimeout(() => { ctx.collapsed.hidden = true; }, 260);
            keepVisibleAfterGrow(ctx, cont);
        });
    }

    /* ── 收起（FLIP 反向）── */
    function collapse(ctx) {
        if (ctx.animating || !ctx.expanded) return;
        ctx.animating = true;
        ctx.expanded = false;

        // 折叠态先就位（透明），作为落点
        ctx.collapsed.hidden = false;
        ctx.collapsed.style.transition = 'none';
        ctx.collapsed.style.opacity = '0';
        const stageRect = rectOf(ctx.collapsed.querySelector('.mp-stage-host'));

        const n = ctx.srcs.length;
        const DUR = 340, STAGGER = 38;
        let done = 0;
        const finishAll = () => { if (++done >= n) finishCollapse(ctx); };

        ctx.rows.forEach((r, i) => fadeAvatar(r.av, i, true));

        ctx.rows.forEach((r, i) => {
            const from = rectOf(r.shell);
            r.shell.style.visibility = 'hidden';
            const flyer = makeFlyer(ctx.srcs[i], from);
            flyer.style.transform = 'translate(0,0) scale(1,1) rotate(0deg)';
            flyer.getBoundingClientRect();
            const delay = (n - 1 - i) * STAGGER;
            flyer.style.transition = `transform ${DUR}ms ${FLIGHT_EASE} ${delay}ms, opacity ${DUR}ms ease ${delay}ms`;
            flyer.style.transform = mapTransform(stageRect, from, fanAngle(i, n));   // 收回堆叠位
            flyer.style.opacity = '0';                                              // 落位后隐入折叠卡后方
            let ended = false;
            const finish = () => {
                if (ended) return; ended = true;
                flyer.remove();
                finishAll();
            };
            flyer.addEventListener('transitionend', finish, { once: true });
            setTimeout(finish, DUR + delay + 140);
        });

        requestAnimationFrame(() => {
            ctx.collapsed.style.transition = 'opacity .24s ease';
            ctx.collapsed.style.opacity = '1';
        });
    }

    function finishCollapse(ctx) {
        ctx.flow.hidden = true;
        ctx.flow.style.opacity = '';
        ctx.rows.forEach(r => { r.shell.style.visibility = ''; r.av.style.opacity = '0'; });
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
