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

    // 生成骑手位置卡片的 HTML（含 SVG 路线与标记占位）
    function riderCardMarkup(order) {
        const isDelivery = window.isDeliveryShoppingOrder(order);
        const shopName = (order.items && order.items[0] && order.items[0].shop_name) || (isDelivery ? '外卖商家' : '商家');
        const rider = ensureRiderInfo(order);
        const moverIcon = isDelivery ? (rider.vehicle === '摩托车' ? '🏍️' : '🛵') : '🚚';
        // 一条从商家(左上)到你(右下)的曲线路径
        const pathD = 'M 26 34 C 90 20, 150 120, 214 128';
        return `
        <div class="rider-track-card" style="background:#fff;border-radius:12px;padding:16px;margin-bottom:15px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="font-weight:bold;font-size:15px;">📍 ${isDelivery ? '骑手' : '快递员'}实时位置</div>
                <div class="rider-track-status" style="font-size:12px;color:#07c160;font-weight:600;"></div>
            </div>
            <div class="rider-track-map" style="position:relative;height:160px;border-radius:10px;overflow:hidden;background:linear-gradient(135deg,#eef3f7,#e3ebf2);">
                <svg viewBox="0 0 240 160" width="100%" height="100%" style="position:absolute;inset:0;">
                    <g stroke="#d7dee6" stroke-width="6" fill="none" stroke-linecap="round">
                        <line x1="-10" y1="52" x2="250" y2="40"/>
                        <line x1="40" y1="-10" x2="70" y2="170"/>
                        <line x1="150" y1="-10" x2="185" y2="170"/>
                        <line x1="-10" y1="110" x2="250" y2="122"/>
                    </g>
                    <path d="${pathD}" fill="none" stroke="#07c160" stroke-width="3" stroke-dasharray="5 5" opacity="0.85"/>
                    <path class="rider-track-path" d="${pathD}" fill="none" stroke="none"/>
                    <g class="rider-track-shop">
                        <circle cx="26" cy="34" r="7" fill="#ff9f0a" stroke="#fff" stroke-width="2"/>
                    </g>
                    <g class="rider-track-home">
                        <circle cx="214" cy="128" r="7" fill="#0a84ff" stroke="#fff" stroke-width="2"/>
                    </g>
                </svg>
                <div class="rider-track-shop-label" style="position:absolute;left:6px;top:44px;font-size:10px;color:#8a5a00;background:rgba(255,255,255,.8);padding:1px 5px;border-radius:6px;">${shopName}</div>
                <div class="rider-track-home-label" style="position:absolute;right:6px;bottom:8px;font-size:10px;color:#0a4a8a;background:rgba(255,255,255,.8);padding:1px 5px;border-radius:6px;">我的位置</div>
                <div class="rider-track-mover" style="position:absolute;left:0;top:0;font-size:22px;transform:translate(-50%,-60%);transition:transform .8s linear;will-change:transform;">${moverIcon}</div>
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

        // 沿路径定位骑手
        let pt = { x: 26, y: 34 };
        if (path && typeof path.getTotalLength === 'function') {
            const len = path.getTotalLength();
            pt = path.getPointAtLength(len * Math.max(0, p));
        }
        if (mover) mover.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%,-60%)`;

        let barPct = Math.max(0, Math.min(1, p)) * 100;

        if (p < 0) {
            // 备餐 / 待发货
            if (statusEl) statusEl.textContent = isDelivery ? '商家备餐中' : '待揽收';
            if (etaEl) etaEl.textContent = isDelivery
                ? `预计 ${window.formatShoppingHm ? window.formatShoppingHm(m.deliverTs) : ''} 送达`
                : '商家正在打包';
            barPct = 4;
            if (mover) mover.style.transform = `translate(26px, 34px) translate(-50%,-60%)`;
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
