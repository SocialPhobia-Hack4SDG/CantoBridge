/**
 * RTC 测试替身：虚拟时钟 + 假 WebSocket / BroadcastChannel / RTCPeerConnection / 麦克风 / Audio。
 *
 * 两处消费方，所以单独抽出来（避免两套假实现各自漂移）：
 *   - `tests/services/rtc.test.mjs` —— 单元测试，全部用假 socket + 虚拟时钟
 *   - `backend/tools/rehearse-rtc.mjs` —— 双端彩排，**换成真 WebSocket 与真定时器**，
 *     只留一个假的 `RTCPeerConnection`（Node 没有 WebRTC，媒体栈是唯一没法在 Node 里跑的一层）
 *
 * 约定：`win` 上挂着 `rtc.js` 会读的全部能力，`session()` 直接喂给它。
 */

import { createCallSession } from '../../src/services/rtc.js';

/** 虚拟时钟：只登记不执行，挂断后能断言「定时器清零」，也不会把测试进程挂住。 */
export function createClock() {
  const tasks = new Map();
  let seq = 0;
  let now = 0;
  return {
    kind: 'virtual',
    get now() {
      return now;
    },
    pending: () => tasks.size,
    tick(ms) {
      now += Number(ms) || 0;
      // 快照遍历：任务里新排的定时器下一轮才跑，不会死循环
      for (const [id, task] of [...tasks]) {
        if (task.at > now) continue;
        if (task.repeat > 0) task.at = now + task.repeat;
        else tasks.delete(id);
        task.fn();
      }
    },
    win: {
      setTimeout(fn, ms = 0) {
        const id = ++seq;
        tasks.set(id, { fn, at: now + (Number(ms) || 0), repeat: 0 });
        return id;
      },
      clearTimeout(id) {
        tasks.delete(id);
      },
      setInterval(fn, ms = 0) {
        const id = ++seq;
        tasks.set(id, { fn, at: now + (Number(ms) || 1), repeat: Number(ms) || 1 });
        return id;
      },
      clearInterval(id) {
        tasks.delete(id);
      },
    },
  };
}

/** 真定时器：双端彩排用（socket 事件走真事件循环，虚拟时钟推进不了它）。 */
export function realTimers() {
  return {
    kind: 'real',
    now: () => Date.now(),
    pending: () => null,
    tick() {},
    win: {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (id) => globalThis.clearTimeout(id),
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (id) => globalThis.clearInterval(id),
    },
  };
}

/** 假 BroadcastChannel：同频道的实例互相投递，自己发的不回自己。 */
export function createBroadcastChannelStub() {
  const channels = new Map();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      for (const peer of [...(channels.get(this.name) ?? [])]) {
        if (peer === this || peer.closed) continue;
        peer.onmessage?.({ data });
      }
    }
    close() {
      this.closed = true;
      channels.get(this.name)?.delete(this);
    }
  }
  return { FakeBroadcastChannel, channels };
}

/**
 * 假 WebSocket：手动 `open()` / `message()` / `serverClose()`，`sent` 里能看到每次上行。
 * `serverClose()` 模拟服务端主动断开（与 `close()` 的区别只在语义，行为一致）。
 */
export function createWebSocketStub({ sockets = [] } = {}) {
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    open() {
      this.readyState = 1;
      this.onopen?.({});
    }
    message(payload) {
      this.onmessage?.({ data: JSON.stringify(payload) });
    }
    raw(text) {
      this.onmessage?.({ data: text });
    }
    serverClose() {
      this.readyState = 3;
      this.onclose?.({});
    }
    close() {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.({});
    }
  }
  return { FakeWebSocket, sockets };
}

/** 假 RTCPeerConnection：记录 remoteDescription / candidate / track，`connected()` 手动推进协商结果。 */
export function createPeerConnectionStub({ connections = [] } = {}) {
  class FakePeerConnection {
    constructor(config) {
      this.config = config;
      this.localDescription = null;
      this.remoteDescriptions = [];
      this.candidates = [];
      this.tracks = [];
      this.closed = false;
      this.connectionState = 'new';
      connections.push(this);
    }
    async createOffer() {
      return { type: 'offer', sdp: 'v=0-offer' };
    }
    async createAnswer() {
      return { type: 'answer', sdp: 'v=0-answer' };
    }
    async setLocalDescription(description) {
      this.localDescription = description;
    }
    async setRemoteDescription(description) {
      this.remoteDescriptions.push(description);
    }
    async addIceCandidate(candidate) {
      this.candidates.push(candidate);
    }
    addTrack(track, stream) {
      this.tracks.push({ track, stream });
    }
    close() {
      this.closed = true;
    }
    /** 模拟 ICE 协商完成 */
    connected() {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    }
    /** 模拟对方的音轨到达（触发 ontrack → attachRemoteAudio） */
    remoteTrack(stream) {
      this.ontrack?.({ streams: [stream] });
    }
  }
  return { FakePeerConnection, connections };
}

/** 假麦克风：`allowed: false` 模拟用户点了「拒绝」。 */
export function createMediaStub({ allowed = true } = {}) {
  const track = {
    kind: 'audio',
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = allowed
    ? async () => stream
    : async () => {
        throw new Error('NotAllowedError: permission denied');
      };
  return { stream, track, getUserMedia };
}

/**
 * 假 Audio：记录被创建出来的远端播放元素，用来断言 ontrack → 播放这条路径。
 *
 * `rejectPlay` 模拟**自动播放策略把 `play()` 拒掉**（真实浏览器上第一次通话就是这样：
 * 页面还没攒够用户激活，`play()` 的 promise 直接 reject）。这条路径以前被 `void` 吞掉，
 * 现在要能被测到，所以替身必须会「拒」。
 */
export function createAudioStub({ rejectPlay = false } = {}) {
  const elements = [];
  class FakeAudio {
    constructor() {
      this.autoplay = false;
      this.hidden = false;
      this.srcObject = null;
      this.played = false;
      this.playCalls = 0;
      this.paused = true;
      /** 挂在元素上（不是挂在闭包上）：测试可以中途改成 false 来演「用户点了一下就解锁了」。 */
      this.rejectPlay = rejectPlay;
      elements.push(this);
    }
    play() {
      this.playCalls += 1;
      if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError: play() failed'));
      this.played = true;
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    remove() {
      this.removed = true;
    }
  }
  return { FakeAudio, elements };
}

/**
 * 假 `document`：只提供「挂/摘手势监听」和「挂播放元素」两件事。
 *
 * 远端声音被自动播放策略挡下时，`rtc.js` 会挂一次性手势监听等用户点屏幕，
 * 所以这条路径必须有一个能手动触发的假 document 才测得到。
 */
export function createDocumentStub() {
  const listeners = new Map();
  const body = {
    children: [],
    appendChild(node) {
      body.children.push(node);
      return node;
    },
  };
  return {
    body,
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    has(type) {
      return listeners.has(type);
    },
    /** 测试里模拟一次用户手势；返回是否真的有人接。 */
    fire(type = 'pointerdown') {
      const handler = listeners.get(type);
      if (!handler) return false;
      handler({ type });
      return true;
    },
  };
}

/**
 * 假 AudioContext：给 analyser 灌一段有能量的波形。
 *
 * 不给这个替身的话 `readMicLevel()` 恒为 0 —— 那么「本端音量上报」与
 * 「对方音量条跟着动」两条路径在测试里就都是死的，跨设备档位最容易坏的地方恰好测不到。
 */
export function createAudioContextStub({ amplitude = 38, suspended = false } = {}) {
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      this.closed = false;
      /** 真实浏览器在没有用户激活时给的是 `'suspended'`：那时 analyser 读不出东西。 */
      this.state = suspended ? 'suspended' : 'running';
      this.resumeCalls = 0;
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = {};
      /**
       * 「播一下」的源节点（翻卡音效）。
       * 翻卡音效必须**复用通话这条上下文**、不能再 `new` 一条（移动端会打断远端人声），
       * 所以这里要能断言「音效确实走的是这条」——`contexts.length` 不变 + `sources` 有增长。
       */
      this.sources = [];
      contexts.push(this);
    }
    resume() {
      this.resumeCalls += 1;
      this.state = 'running';
      return Promise.resolve();
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 512,
        getByteTimeDomainData(buffer) {
          // 交变方波：居中后 RMS = amplitude/128，乘 3.2 后落在 0.9 左右
          for (let index = 0; index < buffer.length; index += 1) {
            buffer[index] = index % 2 === 0 ? 128 - amplitude : 128 + amplitude;
          }
        },
      };
    }
    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    createBufferSource() {
      const node = { buffer: null, connect() {}, start() {}, stop() {} };
      this.sources.push(node);
      return node;
    }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
    }
    close() {
      this.closed = true;
    }
  }
  return { FakeAudioContext, contexts };
}

/**
 * 一次性装好一整套替身。
 *
 * - `timers`：`'virtual'`（单测，能 tick 与断言定时器数）或 `'real'`（双端彩排）
 * - `WebSocket`：传自定义类就换掉假 socket（彩排传真 `ws` 的包装类）
 * - `media`：`true` 允许麦克风 / `false` 连 `mediaDevices` 都没有 / `'denied'` 有但被拒
 * - `rejectRemotePlay`：模拟自动播放策略拒掉 `play()`（第一次通话静默无声的那条路径）
 * - `audioContextSuspended`：模拟 `AudioContext` 起在 `suspended`（没有用户激活）
 * - `document`：给一个假 document（远端声音要挂进 DOM，被拒时还要挂手势监听）
 */
export function createRtcHarness({
  media = true,
  timers = 'virtual',
  WebSocket: WebSocketClass = null,
  sockets = [],
  roomId = 'r-1',
  mode = 'remote',
  signalUrl = 'wss://localhost:4173/ws/rooms/r-1',
  token = 'demo-token',
  peerId = 'peer-a',
  rejectRemotePlay = false,
  audioContextSuspended = false,
  document: documentStub = null,
} = {}) {
  const clock = timers === 'real' ? realTimers() : createClock();
  const { FakeBroadcastChannel, channels } = createBroadcastChannelStub();
  const { FakePeerConnection, connections } = createPeerConnectionStub();
  const { stream, track, getUserMedia } = createMediaStub({ allowed: media !== 'denied' });
  const { FakeAudio, elements: audioElements } = createAudioStub({ rejectPlay: rejectRemotePlay });
  const { FakeAudioContext, contexts: audioContexts } = createAudioContextStub({
    suspended: audioContextSuspended,
  });
  const doc = documentStub ?? createDocumentStub();

  const SocketClass = WebSocketClass ?? createWebSocketStub({ sockets }).FakeWebSocket;

  const win = {
    ...clock.win,
    WebSocket: SocketClass,
    BroadcastChannel: FakeBroadcastChannel,
    RTCPeerConnection: FakePeerConnection,
    Audio: FakeAudio,
    AudioContext: FakeAudioContext,
    document: doc,
    ...(media === false ? {} : { navigator: { mediaDevices: { getUserMedia } } }),
  };

  return {
    win,
    clock,
    sockets,
    connections,
    channels,
    audioElements,
    audioContexts,
    document: doc,
    stream,
    track,

    session: (overrides = {}) =>
      createCallSession({
        roomId,
        mode,
        win,
        signalUrl,
        token,
        peerId,
        ...overrides,
      }),

    /** 信令处理是 async 的：跑几轮微任务再断言 */
    settle: async (rounds = 3) => {
      for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
