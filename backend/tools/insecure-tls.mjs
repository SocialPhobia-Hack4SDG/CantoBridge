/**
 * 自签证书自检的前置：**只给当前这一次运行**关掉 TLS 校验。
 *
 * `smoke:ws` / `preflight:lan` / `rehearse:rtc` 连的都是 `serve.mjs` 现场签出来的
 * 自签证书，不关校验连 `wss` 都握不上手（`DEPTH_ZERO_SELF_SIGNED_CERT`）。
 *
 * **为什么写在代码里，而不是 npm script 里的 `NODE_TLS_REJECT_UNAUTHORIZED=0 node ...`**：
 * 那种「行内环境变量」只有 POSIX shell 认。Windows 的 cmd 与 PowerShell 不认这种写法，
 * 会直接报「'NODE_TLS_REJECT_UNAUTHORIZED' 不是内部或外部命令」——同一份 package.json
 * 在 mac 上跑得通、在 Windows 上三条脚本全红，而且报错信息完全指不到真正的原因。
 * 这一类「把 POSIX 当跨平台写法」的坑在本仓库踩过不止一次，另一次是
 * `tools/check-contract.mjs` 的 `await import(裸路径)`（Windows 上必炸
 * ERR_UNSUPPORTED_ESM_URL_SCHEME，已改用 pathToFileURL）。
 *
 * 作用域与原来**完全等价**：改的是当前进程的环境变量，不落盘、不影响别的进程。
 * 用 `??=` 而不是 `=` 是为了尊重外部显式给的值——`NODE_TLS_REJECT_UNAUTHORIZED=1 npm run smoke:ws`
 * 仍然按「要校验」跑，脚本不会把人的意思盖掉。
 *
 * 用法：在脚本的**第一个** import 位置 `import './insecure-tls.mjs';`。
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';
