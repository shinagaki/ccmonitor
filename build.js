#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building ccmonitor for Node.js...');

// Read package.json to get current version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const currentVersion = packageJson.version;

try {
  // Use Bun to transpile TypeScript to JavaScript
  console.log('🔄 Transpiling TypeScript to JavaScript with Bun...');
  
  // Bun build with Node.js target - remove --standalone that was causing wrapper issues
  execSync('bun build ccmonitor.ts --target node --format cjs --outfile ccmonitor.js', {
    cwd: __dirname,
    stdio: 'inherit'
  });
  
  // Read the generated file and inject version
  let jsContent = fs.readFileSync(path.join(__dirname, 'ccmonitor.js'), 'utf8');
  
  // Replace the shebang for Node.js
  jsContent = jsContent.replace('#!/usr/bin/env bun', '#!/usr/bin/env node');
  
  // Remove CommonJS wrapper - convert to plain JavaScript
  if (jsContent.includes('(function(exports, require, module, __filename, __dirname) {')) {
    // Remove wrapper function and add proper module handling
    jsContent = jsContent.replace(
      '// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {\n',
      '// @bun @bun-cjs - transpiled by build.js\n'
    );
    // Remove the closing wrapper
    jsContent = jsContent.replace(/\}\)$/m, '');
  }
  
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