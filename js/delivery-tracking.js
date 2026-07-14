/*!
 * delivery-tracking.js — 模拟外卖/快递配送
 *  - 订单详情里的"骑手实时位置"地图（按真实时间沿路线移动）
 *  - 送达/派送时向"信息"App 的"快递服务"服务号推送通知
 *
 * 依赖（均为 shopping.js 的全局函数）：getShoppingOrderMilestones / deriveShoppingOrderStatus / isDeliveryShoppingOrder
 */
(function () {
    'use strict';

    /* ============ 系统服务号消息（进"信息"App）============ */
    // 往一个系统服务号线程追加一条消息（role:assistant，走 messages-app 频道）
    window.pushSystemServiceMessage = function (threadId, meta, text, time) {
        const st = window.iphoneSimState;
        if (!st) return null;
        if (!st.systemMessageThreads || typeof st.systemMessageThreads !== 'object') {
            st.systemMessageThreads = {};
        }
        if (!st.systemMessageThreads[threadId]) {
            st.systemMessageThreads[threadId] = {
                id: threadId,
                name: (meta && meta.name) || '服务通知',
                avatar: (meta && meta.avatar) || '',
                messages: []
            };
        }
        const thread = st.systemMessageThreads[threadId];
        if (meta && meta.name) thread.name = meta.name;
        if (meta && meta.avatar != null && meta.avatar !== '') thread.avatar = meta.avatar;

        const msg = {
            id: 'sys-' + threadId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            role: 'assistant',
            type: 'text',
            content: String(text || ''),
            time: Number(time) || Date.now(),
            channel: 'messages-app',
            readInMessagesApp: false
        };
        thread.messages.push(msg);

        try { if (typeof window.saveConfig === 'function') window.saveConfig(); } catch (e) {}
        // 若"信息"App正开着，实时刷新
        if (typeof window.refreshMessagesAppView === 'function') {
            try { window.refreshMessagesAppView(); } catch (e) {}
        }
        return msg;
    };

    /* ============ 骑手数据（每单固定一次）============ */
    const RIDER_SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴'];
    const RIDER_VEHICLES = ['电动车', '摩托车'];

    function ensureRiderInfo(order) {
        if (!order) return { name: '骑手', plate: '', vehicle: '电动车', phoneTail: '0000' };
        if (!order.riderInfo) {
            const rand = (n) => Math.floor(Math.random() * n);
            const surname = RIDER_SURNAMES[rand(RIDER_SURNAMES.length)];
            order.riderInfo = {
                name: surname + '师傅',
                plate: '京A·' + String(10000 + rand(90000)),
                vehicle: RIDER_VEHICLES[rand(RIDER_VEHICLES.length)],
                phoneTail: String(1000 + rand(9000))
            };
            try { if (typeof window.saveConfig === 'function') window.saveConfig(); } catch (e) {}
        }
        return order.riderInfo;
    }
    window.ensureRiderInfo = ensureRiderInfo;

    /* ============ 骑手实时位置地图 ============ */
    // 计算配送进度：0=刚取货，1=已到达；<0=商家备餐中
    function deliveryProgress(order, now) {
        const m = window.getShoppingOrderMilestones(order);
        const shipTs = Number(m.shipTs), deliverTs = Number(m.deliverTs);
        now = Number(now) || Date.now();
        if (now < shipTs) return -1;                     // 备餐/待发货
        if (now >= deliverTs) return 1;                  // 已送达
        const span = Math.max(1, deliverTs - shipTs);
        return Math.max(0, Math.min(1, (now - shipTs) / span));
    }

    function fmtRemain(ms) {
        const mins = Math.max(0, Math.round(ms / 60000));
        if (mins >= 60) {
            const h = Math.floor(mins / 60), mm = mins % 60;
            return mm ? `${h} 小时 ${mm} 分钟` : `${h} 小时`;
        }
        return `${mins} 分钟`;
    }

    // 稳定的每单随机（种子来自订单 id）—— 让每单地图/路线各不相同
    function hashStr(s) {
        let h = 2166136261 >>> 0;
        s = String(s || '');
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // 按订单生成一张"地图"的几何（起终点、路线曲线、路网），同一单稳定
    function orderMapGeometry(order) {
        const seed = hashStr(order && (order.id || order.time || Math.random()));
        const rnd = mulberry32(seed || 1);
        const rr = (min, max) => min + rnd() * (max - min);
        const sx = rr(16, 52), sy = rr(22, 62);          // 商家（左上区域）
        const hx = rr(188, 226), hy = rr(96, 142);        // 我的位置（右下区域）
        const c1x = rr(55, 130), c1y = rr(8, 78);         // 路线控制点（决定弯法）
        const c2x = rr(120, 195), c2y = rr(84, 152);
        const f = (n) => n.toFixed(1);
        const pathD = `M ${f(sx)} ${f(sy)} C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(hx)} ${f(hy)}`;
        let roads = '';
        const n = 3 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
            if (rnd() < 0.5) {
                const y = rr(12, 148);
                roads += `<line x1="-10" y1="${f(y)}" x2="250" y2="${f(y + rr(-16, 16))}"/>`;
            } else {
                const x = rr(24, 216);
                roads += `<line x1="${f(x)}" y1="-10" x2="${f(x + rr(-16, 16))}" y2="170"/>`;
            }
        }
        return { sx, sy, hx, hy, pathD, roads, f };
    }

    // 生成骑手位置卡片的 HTML（地图/路线按订单随机）
    function riderCardMarkup(order) {
        const isDelivery = window.isDeliveryShoppingOrder(order);
        const shopName = (order.items && order.items[0] && order.items[0].shop_name) || (isDelivery ? '外卖商家' : '商家');
        const shopLabel = shopName.length > 8 ? shopName.slice(0, 8) + '…' : shopName;
        const rider = ensureRiderInfo(order);
        const moverIcon = isDelivery ? (rider.vehicle === '摩托车' ? '🏍️' : '🛵') : '🚚';
        const g = orderMapGeometry(order);
        const f = g.f;
        return `
        <div class="rider-track-card" style="background:#fff;border-radius:12px;padding:16px;margin-bottom:15px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="font-weight:bold;font-size:15px;">📍 ${isDelivery ? '骑手' : '快递员'}实时位置</div>
                <div class="rider-track-status" style="font-size:12px;color:#07c160;font-weight:600;"></div>
            </div>
            <div class="rider-track-map" style="position:relative;width:100%;aspect-ratio:3/2;max-height:200px;border-radius:10px;overflow:hidden;background:linear-gradient(135deg,#eef3f7,#e3ebf2);">
                <svg viewBox="0 0 240 160" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="position:absolute;inset:0;display:block;">
                    <g stroke="#d7dee6" stroke-width="6" fill="none" stroke-linecap="round">${g.roads}</g>
                    <path d="${g.pathD}" fill="none" stroke="#07c160" stroke-width="3" stroke-dasharray="5 5" opacity="0.85"/>
                    <path class="rider-track-path" d="${g.pathD}" fill="none" stroke="none"/>
                    <circle cx="${f(g.sx)}" cy="${f(g.sy)}" r="6.5" fill="#ff9f0a" stroke="#fff" stroke-width="2"/>
                    <circle cx="${f(g.hx)}" cy="${f(g.hy)}" r="6.5" fill="#0a84ff" stroke="#fff" stroke-width="2"/>
                    <text x="${f(g.sx)}" y="${f(g.sy - 10)}" text-anchor="middle" font-size="8" fill="#8a5a00" style="paint-order:stroke;stroke:#fff;stroke-width:2.4px;">${shopLabel}</text>
                    <text x="${f(g.hx)}" y="${f(g.hy + 16)}" text-anchor="middle" font-size="8" fill="#0a4a8a" style="paint-order:stroke;stroke:#fff;stroke-width:2.4px;">我的位置</text>
                    <text class="rider-track-mover" text-anchor="middle" dominant-baseline="central" font-size="15" transform="translate(${f(g.sx)},${f(g.sy)})" style="transform:translate(${f(g.sx)}px,${f(g.sy)}px);transition:none;">${moverIcon}</text>
                </svg>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:12px;">
                <div style="width:36px;height:36px;border-radius:50%;background:#07c160;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto;">${isDelivery ? '🛵' : '📦'}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:14px;font-weight:600;">${rider.name} · ${rider.vehicle}${isDelivery ? '' : '（快递）'}</div>
                    <div class="rider-track-eta" style="font-size:12px;color:#666;margin-top:2px;"></div>
                </div>
                <div style="font-size:11px;color:#07c160;border:1px solid #07c160;border-radius:14px;padding:4px 10px;">联系</div>
            </div>
            <div style="height:6px;border-radius:3px;background:#eee;margin-top:12px;overflow:hidden;">
                <div class="rider-track-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#07c160,#3fd47f);transition:width .8s linear;"></div>
            </div>
        </div>`;
    }

    // 根据当前真实时间更新一张骑手卡片
    function updateRiderCard(cardEl, order) {
        if (!cardEl || !cardEl.isConnected) return false;
        const now = Date.now();
        const p = deliveryProgress(order, now);
        const m = window.getShoppingOrderMilestones(order);
        const isDelivery = window.isDeliveryShoppingOrder(order);

        const mover = cardEl.querySelector('.rider-track-mover');
        const path = cardEl.querySelector('.rider-track-path');
        const etaEl = cardEl.querySelector('.rider-track-eta');
        const statusEl = cardEl.querySelector('.rider-track-status');
        const barEl = cardEl.querySelector('.rider-track-bar');

        // 沿路径定位骑手（骑手是 SVG 内元素，与路线/定位点同坐标系，精确对齐）
        if (mover && path && typeof path.getTotalLength === 'function') {
            const len = path.getTotalLength();
            const pt = path.getPointAtLength(len * Math.max(0, Math.min(1, p < 0 ? 0 : p)));
            mover.setAttribute('transform', `translate(${pt.x},${pt.y})`);
            mover.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
            if (!mover.dataset.ready) {
                mover.dataset.ready = '1';
                requestAnimationFrame(() => { mover.style.transition = 'transform .9s linear'; });
            }
        }

        let barPct = Math.max(0, Math.min(1, p)) * 100;

        if (p < 0) {
            // 备餐 / 待发货
            if (statusEl) statusEl.textContent = isDelivery ? '商家备餐中' : '待揽收';
            if (etaEl) etaEl.textContent = isDelivery
                ? `预计 ${window.formatShoppingHm ? window.formatShoppingHm(m.deliverTs) : ''} 送达`
                : '商家正在打包';
            barPct = 4;
        } else if (p >= 1) {
            if (statusEl) statusEl.textContent = '已送达';
            if (etaEl) etaEl.textContent = '订单已送达，请查收';
            barPct = 100;
        } else {
            const remain = Number(m.deliverTs) - now;
            if (statusEl) statusEl.textContent = isDelivery ? '配送中' : '运送中';
            if (etaEl) etaEl.textContent = `预计还有 ${fmtRemain(remain)}送达`;
        }
        if (barEl) barEl.style.width = barPct.toFixed(1) + '%';
        return p < 1;   // 仍需继续更新
    }

    // 对外：把骑手卡片渲染进容器，并启动随真实时间更新（弹窗关闭/移除即停止）
    window.mountRiderTracking = function (containerEl, order) {
        if (!containerEl || !order || !window.isDeliveryShoppingOrder) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = riderCardMarkup(order);
        const cardEl = wrap.firstElementChild;
        containerEl.insertBefore(cardEl, containerEl.firstChild);

        updateRiderCard(cardEl, order);
        const timer = setInterval(() => {
            const modal = document.getElementById('shopping-order-progress-modal');
            const hidden = !modal || modal.classList.contains('hidden');
            if (!cardEl.isConnected || hidden) { clearInterval(timer); return; }
            const keepGoing = updateRiderCard(cardEl, order);
            if (!keepGoing) { /* 到达后仍保留卡片，只是不再移动 */ }
        }, 1500);
    };

    /* ============ 送达/派送通知 ============ */
    const DELIVERY_THREAD_ID = 'delivery-service';
    const DELIVERY_THREAD_NAME = '快递服务';

    function storeNameOf(order) {
        return (order && order.items && order.items[0] && order.items[0].shop_name)
            || (window.isDeliveryShoppingOrder(order) ? '外卖商家' : '商家');
    }

    // 已派送（骑手取货/已发货）
    window.notifyOrderDispatched = function (order) {
        if (!order) return;
        const isDelivery = window.isDeliveryShoppingOrder(order);
        const rider = ensureRiderInfo(order);
        const store = storeNameOf(order);
        const m = window.getShoppingOrderMilestones(order);
        const eta = window.formatShoppingHm ? window.formatShoppingHm(m.deliverTs) : '';
        const text = isDelivery
            ? `【${store}】您的订单已由${rider.name}取货，正在配送中🛵 预计 ${eta} 送达，请保持手机畅通。`
            : `【${store}】您的快递已揽收发出📦 预计 ${window.formatShoppingDateTime ? window.formatShoppingDateTime(m.deliverTs) : ''} 送达。`;
        window.pushSystemServiceMessage(DELIVERY_THREAD_ID, { name: DELIVERY_THREAD_NAME }, text);
    };

    // 已送达
    window.notifyOrderDelivered = function (order) {
        if (!order) return;
        const isDelivery = window.isDeliveryShoppingOrder(order);
        const rider = ensureRiderInfo(order);
        const store = storeNameOf(order);
        const text = isDelivery
            ? `【${store}】您的外卖已送达🎉 ${rider.name}已将餐品放在您指定位置，请及时取用，祝您用餐愉快！`
            : `【${store}】您的快递已送达🎉 请及时查收，如未收到请联系${rider.name}（尾号${rider.phoneTail}）。`;
        window.pushSystemServiceMessage(DELIVERY_THREAD_ID, { name: DELIVERY_THREAD_NAME }, text);
    };
})();
