#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building ccmonitor for Node.js...');

// Read package.json to get current version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const currentVersion = packageJson.version;

try {
  // Use Bun to transpile TypeScript to JavaScript with standalone bundle
  console.log('🔄 Transpiling TypeScript to JavaScript with Bun...');
  
  // Bun build with --standalone to create self-contained Node.js executable  
  execSync('bun build ccmonitor.ts --target node --format cjs --standalone --outfile ccmonitor.js', {
    cwd: __dirname,
    stdio: 'inherit'
  });
  
  // Read the generated file and inject version
  let jsContent = fs.readFileSync(path.join(__dirname, 'ccmonitor.js'), 'utf8');
  
  // Replace the shebang for Node.js
  jsContent = jsContent.replace('#!/usr/bin/env bun', '#!/usr/bin/env node');
  
  // Replace version placeholder with current version from package.json
  jsContent = jsContent.replace(/"ccmonitor v\d+\.\d+\.\d+"/g, `"ccmonitor v${currentVersion}"`);
  
  // Write the final JavaScript file
  fs.writeFileSync(path.join(__dirname, 'ccmonitor.js'), jsContent);
  
  // Make it executable
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(__dirname, 'ccmonitor.js'), '755');
  }
  
  console.log('✅ Build completed: ccmonitor.js');
  console.log('📦 Ready for npm publish');
  
} catch (error) {
  console.error('❌ Build failed:', error.message);
  console.error('Make sure Bun is installed and ccmonitor.ts exists');
  process.exit(1);
}