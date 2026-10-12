/**
 * 通话会话（Call Session）。
 *
 * 三种模式，UI 完全一致，只有音频来源不同：
 *   - 'sim'    模拟通话：假波形 + 计时，零权限、零网络，演示保底（默认）
 *   - 'local'  同浏览器双标签页：BroadcastChannel 交换信令 + 真实 WebRTC 音频
 *   - 'remote' 跨设备：WebSocket 信令（后端 `/ws/rooms/:roomId`）+ 真实 WebRTC 音频
 *
 * **信令是「传输」不是「模式」**：`local` / `remote` 走的是同一套 SDP / ICE 逻辑，
 * 唯一的差别是收发通道。所以这里把收发抽成 `{ kind, post, close }` 三件套，
 * `startWebRtc()` 只认接口不认实现——换传输不需要动一行 WebRTC 代码。
 *
 * 两处口径（改之前先读）：
 *   - **远端档位的线上词汇与内部词汇不同名**：后端 `ROOM_RELAY` 白名单只认
 *     `rtc:offer` / `rtc:answer` / `rtc:ice` / `rtc:level`，所以 `offer` 这类内部名
 *     在 `createRemoteTransport` 里统一翻译，`handleSignal` 完全不用知道自己在哪条通道上。
 *   - **远端档位没有 `hello` 握手，也没有 `bye`**：后端在第二条连接进来时会广播
 *     `room:ready { peerReady }`，离开时广播 `room:peer-left`。谁是发起方也由它决定
 *     （第一条 `room:ready` 的 `peerReady` 为 false = 我先到 = 我发起），不靠随机 id 比大小。
 *
 * 设计原则：任何一步失败都不抛到 UI，而是降级 + 设置 warning，让页面用 FallbackBanner 表达。
 */

import { levelFromWaveform, simulatedLevel, smoothLevel } from '../lib/audio.js';

export const CALL_MODES = ['sim', 'local', 'remote'];

/** 拿不到 `/api/rtc/ice-servers` 时的兜底：同 Wi-Fi 直连只要有 STUN 就够。 */
export const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/** 同浏览器双标签页的频道名前缀（local 档位专用）。 */
export const LOCAL_CHANNEL_PREFIX = 'cantobridge:room:';

const SIM_CONNECT_MS = 700;
const DEGRADE_MS = 8000;
const LEVEL_INTERVAL_MS = 90;

/** 内部词汇 → 线上词汇（只列后端白名单里有的；其余是「同浏览器」专用，不上线）。 */
const REMOTE_UPSTREAM = {
  offer: 'rtc:offer',
  answer: 'rtc:answer',
  ice: 'rtc:ice',
  level: 'rtc:level',
  card: 'room:card',
};
/** 线上词汇 → 内部词汇。 */
const REMOTE_DOWNSTREAM = {
  'rtc:offer': 'offer',
  'rtc:answer': 'answer',
  'rtc:ice': 'ice',
  'rtc:level': 'level',
  'room:card': 'card',
};

function normalizeMode(mode) {
  return CALL_MODES.includes(mode) ? mode : 'sim';
}

/** `{ iceServers, expiresAt }` 与裸数组都接受；空数组、缺 `urls` 的条目一律算「没拿到」。 */
export function normalizeIceServers(value) {
  const list = Array.isArray(value) ? value : value?.iceServers;
  const usable = (Array.isArray(list) ? list : []).filter((item) => item && (item.urls || item.url));
  return usable.length > 0 ? usable : null;
}

/**
 * 同浏览器双标签页的传输：`BroadcastChannel` 直传对象，零序列化成本。
 * 浏览器不支持时返回 `null`，由调用方决定降级到哪一档。
 */
export function createLocalTransport({ win = globalThis, roomId, onMessage } = {}) {
  const Channel = win.BroadcastChannel;
  if (!Channel) return null;
  const channel = new Channel(LOCAL_CHANNEL_PREFIX + roomId);
  channel.onmessage = (event) => onMessage?.(event?.data);
  return {
    kind: 'local',
    post(message) {
      try {
        channel.postMessage(message);
      } catch (error) {
        void error;
      }
    },
    close() {
      try {
        channel.close?.();
      } catch (error) {
        void error;
      }
    },
  };
}

/**
 * 跨设备的传输：一条 WebSocket 连到 `/ws/rooms/:roomId`。
 *
 * - 令牌只能走 `?token=`（浏览器 `WebSocket` 不允许自定义请求头，见后端 `protocol.js`）
 * - 连接建立前发出去的消息先入队，`onopen` 后按顺序补发（`hello` / 第一条 offer 都在这里面）
 * - `room:ready` / `room:peer-left` / `room:ended` 翻译成 `onPeer` 回调，
 *   `rtc:*` 翻译回内部词汇交给 `onMessage`，其余一律丢弃（白名单之外后端也不会转发）
 */
export function createRemoteTransport({ win = globalThis, url = '', token = null, onMessage, onPeer, onStatus } = {}) {
  const Ctor = win.WebSocket;
  if (!Ctor || !url) return null;

  const target = token ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : url;
  let socket;
  try {
    socket = new Ctor(target);
  } catch (error) {
    void error;
    return null;
  }

  const queue = [];
  let open = false;
  /** 第一条 `room:ready` 的 `peerReady` 决定谁是发起方：false = 我先到。 */
  let arrivedFirst = null;

  function write(message) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      void error;
    }
  }

  socket.onopen = () => {
    open = true;
    while (queue.length > 0) write(queue.shift());
  };
  socket.onmessage = (event) => {
    let message = null;
    try {
      message = JSON.parse(String(event?.data ?? ''));
    } catch {
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'room:ready') {
      if (arrivedFirst === null) arrivedFirst = !message.peerReady;
      // 只有我一个人在房里：什么都不用做，等对方进来会再收到一条
      if (!message.peerReady) return;
      onPeer?.({ present: true, offerer: arrivedFirst === true });
      return;
    }
    if (message.type === 'room:peer-left' || message.type === 'room:ended') {
      onPeer?.({ present: false });
      return;
    }
    if (message.type === 'error') {
      onStatus?.('error');
      return;
    }

    const type = REMOTE_DOWNSTREAM[message.type];
    if (!type) return;
    onMessage?.({ ...message, type });
  };
  socket.onerror = () => onStatus?.('error');
  socket.onclose = () => onStatus?.('closed');

  return {
    kind: 'remote',
    post(message) {
      const type = REMOTE_UPSTREAM[message?.type];
      if (!type) return; // hello / hello-ack / bye 只在同浏览器档位有意义
      const payload = { ...message, type };
      if (open) write(payload);
      else queue.push(payload);
    },
    close() {
      try {
        socket.close?.();
      } catch (error) {
        void error;
      }
    },
  };
}

export function createCallSession({
  roomId,
  mode = 'sim',
  win = globalThis,
  clock = () => Date.now(),
  peerId,
  signalUrl = '',
  token = null,
  iceServers = null,
  loadIceServers = null,
} = {}) {
  const requested = normalizeMode(mode);
  const listeners = new Set();
  /** 话题卡同步的订阅者（与通话状态分开：翻卡不是通话状态，不该塞进 snapshot）。 */
  const cardListeners = new Set();
  const myId = peerId ?? 'peer-' + Math.random().toString(36).slice(2, 8);

  let transport = null;
  let connection = null;
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let analyserBuffer = null;
  let loopTimer = null;
  let connectTimer = null;
  let degradeTimer = null;
  let levelTimer = null;
  let stopped = false;
  /** 远端声音的播放元素：整个会话只建一个（见 attachRemoteAudio）。 */
  let audioElement = null;
  let audioBlocked = false;
  /** 「用户下一次手势就把声音接上」的监听。**从会话开始就挂着**，真正出声才摘（见 bindUnlockOnGesture）。 */
  let unlockHandler = null;
  /** 连接还没建好时到达的「对方进来了 / 对方走了」，建好之后补处理。 */
  let pendingPeer = null;

  const raw = { self: 0, peer: 0 };
  let smoothed = { self: 0, peer: 0 };

  let state = {
    requestedMode: requested,
    mode: requested,
    status: 'connecting',
    muted: false,
    speakerOn: true,
    hasMic: false,
    peerPresent: false,
    peerLeft: false,
    /** 远端声音被浏览器的自动播放策略挡下了（第一次通话静默无声的根因，见 attachRemoteAudio）。 */
    audioBlocked: false,
    warning: null,
    startedAt: clock(),
  };

  function snapshot() {
    return { ...state };
  }

  function notify() {
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch (error) {
        void error;
      }
    }
  }

  function patch(next) {
    state = { ...state, ...next };
    notify();
  }

  /* ---------- 模式 1：模拟通话 ---------- */
  function startSim(reason) {
    if (connectTimer) win.clearTimeout?.(connectTimer);
    connectTimer = win.setTimeout(() => {
      if (!stopped) patch({ status: 'live' });
    }, SIM_CONNECT_MS);
    if (reason) patch({ warning: reason, mode: 'sim' });
  }

  /* ---------- 模式 2 / 3：真实音频 ---------- */
  function stopMedia() {
    for (const track of stream?.getTracks?.() ?? []) {
      try {
        track.stop();
      } catch (error) {
        void error;
      }
    }
    stream = null;
    try {
      audioContext?.close?.();
    } catch (error) {
      void error;
    }
    audioContext = null;
    analyser = null;
    analyserBuffer = null;
    // 播放元素与「手势解锁」监听一起收掉：别把上个房间的播放器留在 DOM 上，
    // 也别让一次迟到的点击去唤醒一个已经结束的会话。
    detachUnlock();
    try {
      if (audioElement) {
        audioElement.pause?.();
        audioElement.srcObject = null;
        audioElement.remove?.();
      }
    } catch (error) {
      void error;
    }
    audioElement = null;
    audioBlocked = false;
  }

  async function startMedia() {
    const devices = win.navigator?.mediaDevices;
    if (!devices?.getUserMedia) return false;
    try {
      stream = await devices.getUserMedia({ audio: true, video: false });
    } catch {
      return false;
    }
    try {
      const Ctor = win.AudioContext ?? win.webkitAudioContext;
      if (Ctor) {
        audioContext = new Ctor();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserBuffer = new Uint8Array(analyser.fftSize);
        // 没有用户激活时上下文是 `suspended`，此时 `readMicLevel()` 恒为 0：
        // 自己的波形是平的、报给对方的音量也是 0，对面看着就像「听不见你」。先试着恢复一次。
        if (audioContext.state === 'suspended') void audioContext.resume?.();
      }
    } catch (error) {
      void error;
    }
    return true;
  }

  function readMicLevel() {
    if (!analyser || !analyserBuffer) return 0;
    try {
      analyser.getByteTimeDomainData(analyserBuffer);
      return levelFromWaveform(analyserBuffer);
    } catch {
      return 0;
    }
  }

  function send(payload) {
    try {
      transport?.post?.(payload);
    } catch (error) {
      void error;
    }
  }

  /**
   * 远端声音：**一个持久的 `<audio>` + 失败要能重试**。
   *
   * 这里以前只写了三行，结果就是「第一次通话听不见、第二次进房才响」。三个坑叠在一起：
   *
   *   1. `play()` 返回的是 promise，**被自动播放策略拒的时候是 reject**。
   *      以前 `void element.play()` 直接把它丢了 —— 拒了没人知道、也没人重试，
   *      界面照样显示「已接通」，于是静默无声。第二次进房时页面已经攒够用户激活，
   *      同一个 `play()` 就成功了，看起来像「第二次就好了」。
   *   2. 元素**不挂进 DOM** 的话，iOS Safari 经常根本不播。挂到 `body` 上、用 `hidden` 藏起来。
   *   3. 每次 `ontrack` 都新建一个元素的话，重协商（或第二次 ontrack）会把正在出声的
   *      那个换掉。所以整个会话只建一个，后面只改 `srcObject`。
   *
   * 被拒之后**挂一次性手势监听**：用户下一次点屏幕就 `resume()` + 重播。
   * 页面据此把 `room.gesture`（「点一下开始通话」）从提示升级成警告。
   */
  function ensureAudioElement() {
    if (audioElement) return audioElement;
    const AudioCtor = win.Audio;
    if (!AudioCtor) return null;
    try {
      const element = new AudioCtor();
      element.autoplay = true;
      element.muted = !state.speakerOn;
      element.hidden = true;
      win.document?.body?.appendChild?.(element);
      audioElement = element;
    } catch (error) {
      void error;
      return null;
    }
    return audioElement;
  }

  function detachUnlock() {
    if (!unlockHandler) return;
    for (const type of ['pointerdown', 'touchstart', 'keydown']) {
      try {
        win.document?.removeEventListener?.(type, unlockHandler);
      } catch (error) {
        void error;
      }
    }
    unlockHandler = null;
  }

  /**
   * 等用户手势把声音接上。**从会话一开始就挂着，而且不是一次性的。**
   *
   * 以前只在 `play()` 被拒之后才挂 `{ once: true }` 的监听，于是有这么一条必踩的路：
   * 用户进房看到「点一下开始通话」就先点了一下 —— 那一瞬间音轨还没到、监听也还没挂，
   * 这一点被白白吃掉；等音轨真到了、`play()` 真被拒了，监听才挂上，而用户已经不会再点第二次。
   * 结果就是**第一次进房一直静音**，第二次进房因为页面早攒够了激活才出声。
   * 现在全程挂着（点多少次都算），真正出声或会话结束才由 `detachUnlock` 摘掉。
   */
  function bindUnlockOnGesture() {
    if (unlockHandler || !win.document?.addEventListener) return;
    unlockHandler = () => {
      void resumeAudio();
    };
    for (const type of ['pointerdown', 'touchstart', 'keydown']) {
      try {
        win.document.addEventListener?.(type, unlockHandler);
      } catch (error) {
        void error;
      }
    }
  }

  function playRemoteAudio() {
    const element = audioElement;
    if (typeof element?.play !== 'function') return;
    let result = null;
    try {
      result = element.play();
    } catch (error) {
      void error;
      result = null;
    }
    // 老 iOS 的 `play()` 不返回 promise，只能靠 `paused` 判断，这里不强行断言
    if (!result || typeof result.then !== 'function') return;
    result.then(
      () => {
        // 真的出声了：解锁监听可以摘了；被拒的标记也要如实收回
        detachUnlock();
        if (!audioBlocked) return;
        audioBlocked = false;
        patch({ audioBlocked: false });
      },
      () => {
        // 被自动播放策略拒了：**记下来并等手势**，不再静默吞掉
        if (audioBlocked) return;
        audioBlocked = true;
        patch({ audioBlocked: true });
        bindUnlockOnGesture();
      },
    );
  }

  /** 重新尝试出声：先恢复 `AudioContext`，再 `play()`。在手势里调它必然成功。 */
  async function resumeAudio() {
    try {
      if (audioContext?.state === 'suspended') await audioContext.resume?.();
    } catch (error) {
      void error;
    }
    playRemoteAudio();
    return !audioBlocked;
  }

  function attachRemoteAudio(remoteStream) {
    const element = ensureAudioElement();
    if (!element) return;
    try {
      element.srcObject = remoteStream;
    } catch (error) {
      void error;
      return;
    }
    playRemoteAudio();
    state = { ...state, remoteAudio: element };
  }

  /* ---------- 信令传输 ---------- */
  function openTransport() {
    const onMessage = (message) => void handleSignal(message);
    if (requested === 'remote') {
      const remote = createRemoteTransport({
        win,
        url: signalUrl,
        token,
        onMessage,
        onPeer,
        onStatus: onSignalStatus,
      });
      if (remote) return remote;
      // 远端档位拿不到地址（或浏览器不支持）：退到同浏览器双标签页，挂提示但不中断
      patch({ warning: 'remote-signal-missing' });
    }
    return createLocalTransport({ win, roomId, onMessage });
  }

  function onSignalStatus(status) {
    // `transport` 已被置空 = 是我们自己主动收的，不是异常
    if (stopped || !transport) return;
    if (status === 'error') patch({ warning: 'remote-signal-failed' });
    else if (state.status !== 'ended') patch({ status: 'degraded' });
  }

  function onPeer(event) {
    if (stopped || !transport) return;
    // 还在等麦克风授权 / 拉 ICE 配置时先攒着，连接建好之后补处理
    if (!connection) {
      pendingPeer = event;
      return;
    }
    applyPeer(event);
  }

  function applyPeer(event) {
    if (!event || stopped) return;
    if (event.present) {
      patch({ peerPresent: true });
      // 远端档位：谁是发起方由后端第一条 `room:ready` 决定（见 createRemoteTransport）
      if (event.offerer) void makeOffer();
      return;
    }
    patch({ peerLeft: true, status: 'ended', peerPresent: false });
  }

  function shouldOffer(peerFrom) {
    // 远端档位不走这条路径：那边没有 `hello`，发起方由 `room:ready` 直接定（见 applyPeer）
    return transport?.kind !== 'remote' && myId > peerFrom;
  }

  async function makeOffer() {
    if (!connection) return;
    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      send({ type: 'offer', from: myId, sdp: connection.localDescription });
    } catch (error) {
      void error;
    }
  }

  /** STUN / TURN 配置：注入的 > 现拉的 > 写死兜底。任何一步失败都不该让通话起不来。 */
  async function resolveIceServers() {
    const provided = normalizeIceServers(iceServers);
    if (provided) return provided;
    if (typeof loadIceServers === 'function') {
      try {
        const fetched = normalizeIceServers(await loadIceServers());
        if (fetched) return fetched;
      } catch (error) {
        void error;
      }
    }
    return DEFAULT_ICE_SERVERS;
  }

  async function startWebRtc() {
    const PeerConnection = win.RTCPeerConnection ?? win.webkitRTCPeerConnection;
    if (!PeerConnection) {
      startSim('webrtc-unsupported');
      return false;
    }

    // 先开信令再建连接：socket 握手与麦克风授权并行，别让用户先干等授权
    transport = openTransport();
    if (!transport) {
      startSim('signal-unsupported');
      return false;
    }
    patch({ mode: transport.kind }); // 远端退到 local 时，界面如实反映实际档位

    patch({ hasMic: await startMedia() });
    if (!state.hasMic) patch({ warning: 'mic-unavailable' });
    // 从这一刻起就等用户手势：音轨到达之前的那一下点击同样要算数（见 bindUnlockOnGesture）
    bindUnlockOnGesture();

    connection = new PeerConnection({ iceServers: await resolveIceServers() });
    connection.onicecandidate = (event) => {
      if (event.candidate) send({ type: 'ice', from: myId, candidate: event.candidate });
    };
    connection.ontrack = (event) => attachRemoteAudio(event.streams?.[0]);
    connection.onconnectionstatechange = () => {
      const next = connection.connectionState;
      if (next === 'connected') patch({ status: 'live', peerPresent: true });
      if (next === 'failed' || next === 'disconnected') patch({ status: 'degraded' });
    };
    if (stream) for (const track of stream.getTracks()) connection.addTrack(track, stream);

    // 连接建好之前到达的「对方进来了」在这里补处理（远端档位靠它触发 offer）
    if (pendingPeer) {
      const event = pendingPeer;
      pendingPeer = null;
      applyPeer(event);
    }

    send({ type: 'hello', from: myId });
    degradeTimer = win.setTimeout(() => {
      if (!stopped && state.status !== 'live') patch({ status: 'degraded' });
    }, DEGRADE_MS);
    levelTimer = win.setInterval(() => {
      if (state.status === 'live') send({ type: 'level', from: myId, value: Math.round(raw.self * 100) / 100 });
    }, LEVEL_INTERVAL_MS);
    return true;
  }

  async function handleSignal(message) {
    if (!message || message.from === myId || stopped) return;
    try {
      if (message.type === 'hello') {
        patch({ peerPresent: true });
        send({ type: 'hello-ack', from: myId });
        if (shouldOffer(message.from)) await makeOffer();
        return;
      }
      if (message.type === 'hello-ack') {
        patch({ peerPresent: true });
        return;
      }
      if (message.type === 'offer' && connection) {
        await connection.setRemoteDescription(message.sdp);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        send({ type: 'answer', from: myId, sdp: connection.localDescription });
        return;
      }
      if (message.type === 'answer' && connection) {
        await connection.setRemoteDescription(message.sdp);
        return;
      }
      if (message.type === 'ice' && connection) {
        await connection.addIceCandidate(message.candidate);
        return;
      }
      if (message.type === 'level') {
        raw.peer = Math.max(0, Math.min(1, Number(message.value) || 0));
        return;
      }
      if (message.type === 'card') {
        // 对方翻到哪一张了。信令层只转发、不判断，这里也只把载荷交给订阅者，
        // 「跟过去」这件事由房间页决定（它才知道自己的牌堆长什么样）。
        for (const listener of cardListeners) {
          try {
            listener({
              cardId: message.cardId ?? null,
              index: Number(message.index) || 0,
              // 第几叠：换了叠之后对面要跟着取同一叠（种子同源，取到的是同一批卡）
              round: Number(message.round) || 0,
            });
          } catch (error) {
            void error;
          }
        }
        return;
      }
      if (message.type === 'bye') {
        patch({ peerLeft: true, status: 'ended', peerPresent: false });
      }
    } catch (error) {
      void error;
    }
  }

  function startLoop() {
    if (loopTimer) return;
    const step = () => {
      if (stopped) return;
      const elapsed = clock() - state.startedAt;
      if (state.mode === 'sim') {
        raw.self = state.muted ? 0 : simulatedLevel(elapsed, 0.4);
        raw.peer = state.peerLeft || state.status === 'connecting' ? 0 : simulatedLevel(elapsed, 2.1);
      } else {
        raw.self = state.muted ? 0 : readMicLevel();
      }
      smoothed = {
        self: smoothLevel(smoothed.self, raw.self),
        peer: smoothLevel(smoothed.peer, raw.peer),
      };
      loopTimer = win.setTimeout(step, 40);
    };
    loopTimer = win.setTimeout(step, 40);
  }

  /** 收掉传输。**先把引用置空再关**：close 事件回来时 `onSignalStatus` 才认得出「是自己收的」。 */
  function closeTransport() {
    const dying = transport;
    transport = null;
    try {
      dying?.close?.();
    } catch (error) {
      void error;
    }
  }

  function closeConnection() {
    try {
      connection?.close?.();
    } catch (error) {
      void error;
    }
    connection = null;
  }

  return {
    roomId,
    peerId: myId,

    async start() {
      if (state.mode === 'sim') startSim(null);
      else await startWebRtc();
      startLoop();
      return snapshot();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * 订阅「对方翻到哪一张话题卡」。返回取消订阅的函数。
     * `sim` 档位（或对端不在）永远不会触发——页面据此天然降级，不需要额外判断。
     */
    onCard(listener) {
      cardListeners.add(listener);
      return () => cardListeners.delete(listener);
    },

    /**
     * 告诉对方我翻到哪一张了。
     * 载荷带 `cardId` / `index` / `round`：两边牌堆万一漂移，接收方还能按 id 找回同一张；
     * `round` 变了说明我换了一叠（「再来八张」），对面要跟着取同一叠。
     */
    sendCard({ cardId = null, index = 0, round = 0 } = {}) {
      send({ type: 'card', from: myId, cardId, index: Number(index) || 0, round: Number(round) || 0 });
    },

    snapshot,
    levels: () => ({ ...smoothed }),

    /**
     * 通话正在用的那条 `AudioContext`（没起来时为 `null`）。
     *
     * 给房间页的翻卡音效复用：**通话进行中绝不能另起一条**，否则移动端会重新协商
     * 音频会话，把正在播的远端人声打断（「一翻话题卡声音就断」）。
     */
    getAudioContext: () => audioContext,

    /**
     * 手动重试出声：先恢复 `AudioContext`，再 `play()` 远端音轨。
     * 正常路径不需要页面调它（`rtc.js` 自己挂了手势监听），留给「用户明确点了一下」的场合。
     */
    resumeAudio,

    setMode(next) {
      const target = normalizeMode(next);
      patch({ mode: target, status: target === 'sim' && state.status !== 'ended' ? 'live' : state.status });
      return snapshot();
    },

    toggleMute() {
      const muted = !state.muted;
      for (const track of stream?.getAudioTracks?.() ?? []) track.enabled = !muted;
      patch({ muted });
      return muted;
    },

    setSpeakerEnabled(enabled) {
      if (stopped) return state.speakerOn;
      const speakerOn = Boolean(enabled);
      if (audioElement) audioElement.muted = !speakerOn;
      patch({ speakerOn });
      if (speakerOn) void resumeAudio();
      return speakerOn;
    },

    async hangup() {
      if (stopped) return snapshot();
      stopped = true;
      send({ type: 'bye', from: myId });
      if (connectTimer) win.clearTimeout?.(connectTimer);
      if (degradeTimer) win.clearTimeout?.(degradeTimer);
      if (levelTimer) win.clearInterval?.(levelTimer);
      if (loopTimer) win.clearTimeout?.(loopTimer);
      loopTimer = null;
      closeConnection();
      closeTransport();
      stopMedia();
      patch({ status: 'ended', audioBlocked: false });
      return snapshot();
    },

    /** 8 秒没连上时，页面可以一键切到模拟通话继续演。 */
    async fallbackToSim() {
      stopped = true;
      send({ type: 'bye', from: myId });
      closeConnection();
      closeTransport();
      stopMedia();
      stopped = false;
      state = { ...state, mode: 'sim', warning: 'manual-sim', status: 'live', audioBlocked: false };
      startLoop();
      notify();
      return snapshot();
    },
  };
}
