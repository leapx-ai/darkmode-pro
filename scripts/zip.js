const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取版本号
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/manifest.json'), 'utf8'));
const version = manifest.version;
const name = 'darkmode-pro';
const zipName = `${name}-v${version}.zip`;

console.log(`📦 打包 ${zipName}...`);

// 确保 releases 目录存在
const releasesDir = path.join(__dirname, '../releases');
if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
}

// 执行 zip 命令
try {
  const zipPath = path.join(releasesDir, zipName);
  
  // 检查操作系统
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    // Windows 使用 PowerShell
    execSync(`powershell Compress-Archive -Path dist/* -DestinationPath "${zipPath}" -Force`, {
      stdio: 'inherit',
    });
  } else {
    // macOS/Linux 使用 zip
    execSync(`cd dist && zip -r "${zipPath}" . -x "*.map"`, {
      stdio: 'inherit',
    });
  }
  
  console.log(`✅ 打包完成: releases/${zipName}`);
  
  // 显示文件大小
  const stats = fs.statSync(zipPath);
  const sizeKB = (stats.size / 1024).toFixed(2);
  console.log(`📊 文件大小: ${sizeKB} KB`);
} catch (error) {
  console.error('❌ 打包失败:', error.message);
  process.exit(1);
}
