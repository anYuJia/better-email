/**
 * 测试专用 node 模块最小类型声明。
 * 测试需要读取真实 CSS 文件做渲染级断言；项目未引入 @types/node
 * （避免与 DOM lib 的 setTimeout 等全局类型冲突），这里只声明用到的 API。
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
