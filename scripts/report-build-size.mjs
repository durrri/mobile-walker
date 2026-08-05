import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const distDir = process.argv[2] ?? 'dist';
const largeFileThreshold = Number(process.env.BUILD_SIZE_LARGE_FILE_BYTES ?? 250 * 1024);
const majorAssetLimit = Number(process.env.BUILD_SIZE_MAJOR_ASSET_COUNT ?? 12);

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
};

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      files.push({ path: relative(distDir, fullPath), bytes: info.size });
    }
  }
  return files;
}

let files;
try {
  files = await collectFiles(distDir);
} catch (error) {
  console.error(`Unable to inspect build output at ${distDir}: ${error.message}`);
  process.exitCode = 1;
  process.exit();
}

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const largestFiles = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, majorAssetLimit);
const unusuallyLargeFiles = files.filter((file) => file.bytes >= largeFileThreshold).sort((a, b) => b.bytes - a.bytes);

const rows = (items) => items.length === 0
  ? '_None._'
  : ['| File | Size |', '| --- | ---: |', ...items.map((file) => `| \`${file.path}\` | ${formatBytes(file.bytes)} |`)].join('\n');

const report = [
  '## Build size report',
  '',
  `Total production build size: **${formatBytes(totalBytes)}** (${totalBytes} bytes).`,
  '',
  `### Largest ${largestFiles.length} generated assets`,
  rows(largestFiles),
  '',
  `### Files at or above ${formatBytes(largeFileThreshold)}`,
  rows(unusuallyLargeFiles),
  '',
  '_Informational only: no hard size budget is enforced yet. Treat this run as the current baseline for future comparison._',
].join('\n');

console.log(report);
