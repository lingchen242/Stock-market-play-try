/**
 * 打包后清理：dist/ 里只留 Windows 版 exe。
 *
 * `neu build` 会为所有支持的平台一起生成二进制（macOS、Linux 全都出来），
 * 对一个只发 Windows 的小游戏来说纯粹是噪音。这里把无关产物删掉，
 * 让 dist/ 里只剩一个可以直接拷给别人的 exe。
 */
import { readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const KEEP = /win_x64\.exe$/i;

if (!existsSync(DIST)) {
  console.error('× dist/ 不存在，请先运行 npm run neutralino:build');
  process.exit(1);
}

const kept = [];
let removed = 0;

for (const entry of readdirSync(DIST)) {
  const full = join(DIST, entry);

  if (statSync(full).isDirectory()) {
    for (const file of readdirSync(full)) {
      const path = join(full, file);
      if (KEEP.test(file)) kept.push({ path, size: statSync(path).size });
      else { rmSync(path, { force: true }); removed += 1; }
    }
  } else {
    // 全平台压缩包（mac/linux 运行时都在里面），Windows 版用不上
    rmSync(full, { force: true });
    removed += 1;
  }
}

if (kept.length === 0) {
  console.error('× 没有找到 Windows 版 exe，打包可能失败了');
  process.exit(1);
}

console.log(`已清理 ${removed} 个非 Windows 产物。最终交付物：`);
for (const file of kept) {
  console.log(`  ${file.path.replace(ROOT + '\\', '')}  ${(file.size / 1024 / 1024).toFixed(2)} MB`);
}
