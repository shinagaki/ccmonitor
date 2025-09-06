#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building ccmonitor for Node.js...');

// Read package.json to get current version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const currentVersion = packageJson.version;

try {
  // Update TypeScript file with current version
  console.log(`📝 Updating TypeScript version to v${currentVersion}...`);
  let tsContent = fs.readFileSync(path.join(__dirname, 'ccmonitor.ts'), 'utf8');
  tsContent = tsContent.replace(/ccmonitor v__VERSION__/g, `ccmonitor v${currentVersion}`);
  fs.writeFileSync(path.join(__dirname, 'ccmonitor.ts'), tsContent);
  
  // Use Bun to transpile TypeScript to JavaScript with standalone bundle
  console.log('🔄 Transpiling TypeScript to JavaScript with Bun...');
  
  // Bun build with file output (more reliable than stdout capture)
  execSync('bun build ccmonitor.ts --target node --format cjs --outfile ccmonitor.js', {
    cwd: __dirname,
    stdio: 'pipe' // Capture any issues without showing noise
  });
  
  // Read the generated file
  let jsContent = fs.readFileSync(path.join(__dirname, 'ccmonitor.js'), 'utf8');
  
  // Remove CommonJS wrapper that Bun adds and make it directly executable
  if (jsContent.includes('(function(exports, require, module, __filename, __dirname)')) {
    // Extract the main content from the wrapper
    const wrapperStart = jsContent.indexOf('{') + 1;
    const wrapperEnd = jsContent.lastIndexOf('})');
    const mainContent = jsContent.substring(wrapperStart, wrapperEnd);
    
    // Create directly executable JavaScript
    jsContent = `#!/usr/bin/env node

${mainContent}`;
  } else {
    // Replace the shebang for Node.js
    jsContent = jsContent.replace('#!/usr/bin/env bun', '#!/usr/bin/env node');
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