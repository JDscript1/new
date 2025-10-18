const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const railwayDir = path.resolve(__dirname, '..');

const sources = [
  { src: path.join(projectRoot, 'public'), dest: path.join(railwayDir, 'public') },
  { src: path.join(projectRoot, 'server'), dest: path.join(railwayDir, 'server') },
  { src: path.join(projectRoot, 'data'), dest: path.join(railwayDir, 'data') }
];

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const { src, dest } of sources) {
  copyDir(src, dest);
}

console.log('✅ Assets și cod backend copiate în Railway/');


