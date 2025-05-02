/* eslint-env node */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Calculate paths relative to the script location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..'); // Go up one level from scripts/ to frontend/
const rootDir = path.resolve(frontendDir, '..'); // Go up one level from frontend/ to the project root

const manifestPath = path.join(rootDir, 'custom_components', 'marees_france', 'manifest.json');
const packageJsonPath = path.join(frontendDir, 'package.json');

try {
  // Read manifest.json
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifestData = JSON.parse(manifestContent);
  const manifestVersion = manifestData.version;

  if (!manifestVersion) {
    console.error('Error: Version not found in manifest.json');
    process.exit(1);
  }

  // Read package.json
  const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJsonData = JSON.parse(packageJsonContent);

  // Update version if different
  if (packageJsonData.version !== manifestVersion) {
    console.log(`Syncing version: ${packageJsonData.version} -> ${manifestVersion}`);
    packageJsonData.version = manifestVersion;
    // Write updated package.json back (with 2-space indentation)
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJsonData, null, 2) + '\n', 'utf8');
    console.log('frontend/package.json version updated successfully.');
  } else {
    console.log(`Version is already up to date: ${manifestVersion}`);
  }

} catch (error) {
  console.error('Error syncing version:', error);
  process.exit(1);
}