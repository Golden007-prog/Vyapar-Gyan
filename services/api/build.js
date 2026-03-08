#!/usr/bin/env node
/**
 * Build script for Lambda deployment
 * Copies package.json and installs only production dependencies in dist/
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📦 Preparing Lambda deployment package...');

// Copy package.json to dist
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const distPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  dependencies: packageJson.dependencies,
};

fs.writeFileSync(
  path.join('dist', 'package.json'),
  JSON.stringify(distPackageJson, null, 2)
);

console.log('✅ Copied package.json to dist/');

// Install production dependencies in dist/
console.log('📥 Installing production dependencies...');
try {
  execSync('npm install --production --no-package-lock', {
    cwd: path.join(__dirname, 'dist'),
    stdio: 'inherit',
  });
  console.log('✅ Production dependencies installed');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error.message);
  process.exit(1);
}

console.log('🎉 Build complete!');
