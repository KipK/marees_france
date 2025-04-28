import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Replicate __dirname behavior in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainPackagePath = path.resolve(__dirname, 'package.json');
const generatedPackagePath = path.resolve(__dirname, 'lib/home-assistant-frontend-types/package.json');
const backupPath = path.resolve(__dirname, 'package.json.bak');

console.log('Starting dependency check and merge...');
console.log(`Main package.json: ${mainPackagePath}`);
console.log(`Generated package.json: ${generatedPackagePath}`);

try {
    // --- Read Files ---
    if (!fs.existsSync(mainPackagePath)) {
        throw new Error(`Main package.json not found at ${mainPackagePath}`);
    }
    if (!fs.existsSync(generatedPackagePath)) {
        throw new Error(`Generated package.json not found at ${generatedPackagePath}`);
    }

    const mainPackageContent = fs.readFileSync(mainPackagePath, 'utf-8');
    const generatedPackageContent = fs.readFileSync(generatedPackagePath, 'utf-8');

    // --- Parse JSON ---
    const mainPackageJson = JSON.parse(mainPackageContent);
    const generatedPackageJson = JSON.parse(generatedPackageContent);

    // --- Ensure dependencies sections exist ---
    if (!mainPackageJson.dependencies) {
        mainPackageJson.dependencies = {}; // Initialize if missing
    }
    if (!generatedPackageJson.dependencies) {
        console.log('No dependencies found in generated package.json. Nothing to merge.');
        process.exit(0); // process is available globally
    }

    // --- Check and Merge Dependencies ---
    let addedCount = 0;
    let needsWrite = false;
    const generatedDeps = generatedPackageJson.dependencies;
    const mainDeps = mainPackageJson.dependencies;

    console.log('Checking dependencies:');
    for (const depName in generatedDeps) {
        if (Object.prototype.hasOwnProperty.call(generatedDeps, depName)) {
            const generatedVersion = generatedDeps[depName];

            if (mainDeps[depName]) {
                // Dependency already exists in main package.json
                if (mainDeps[depName] !== generatedVersion && generatedVersion !== "*") {
                    // Version conflict AND generated version is not "*"
                    throw new Error(
                        `Dependency conflict for "${depName}":\n` +
                        `  Main package.json requires: "${mainDeps[depName]}"\n` +
                        `  Generated package.json requires: "${generatedVersion}" (and is not "*")\n` +
                        `Please resolve the conflict manually in ${mainPackagePath}.`
                    );
                } else {
                    // Exists with same version OR generated version is "*", do nothing (keep main version)
                    const reason = generatedVersion === "*" ? `keeping existing version "${mainDeps[depName]}"` : `already exists with version "${generatedVersion}"`;
                    console.log(`  - Skipping ${depName}: ${reason}.`);
                }
            } else {
                // Dependency does not exist, add it
                console.log(`  - Adding ${depName}: "${generatedVersion}"`);
                mainDeps[depName] = generatedVersion;
                addedCount++;
                needsWrite = true; // Mark that we need to save changes
            }
        }
    }

    if (!needsWrite) {
        console.log('No new dependencies to add.');
        process.exit(0);
    }

    // --- Backup and Write File ---
    console.log(`Creating backup: ${backupPath}`);
    fs.copyFileSync(mainPackagePath, backupPath); // Simple backup

    console.log('Writing updated package.json...');
    // Write back with standard JSON formatting (2 spaces)
    fs.writeFileSync(mainPackagePath, JSON.stringify(mainPackageJson, null, 2) + '\n'); // Add trailing newline

    console.log(`\n✓ Successfully added ${addedCount} new dependencies to ${mainPackagePath}.`);
    console.log('Remember to run "npm install" in the frontend directory to install the new dependencies.');

} catch (error) {
    console.error('\nError during dependency merge:');
    console.error(error.message); // Print only the error message for clarity
    process.exit(1);
}