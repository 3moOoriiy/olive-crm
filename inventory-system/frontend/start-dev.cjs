// Dev server launcher - ensures correct working directory for Tailwind
const { spawn } = require('child_process');
const path = require('path');

const frontendDir = __dirname;
const viteBin = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');

const child = spawn(process.execPath, [viteBin, '--port', '5173', '--host'], {
  stdio: 'inherit',
  cwd: frontendDir,
  env: { ...process.env },
});

child.on('exit', (code) => process.exit(code));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
