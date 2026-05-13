/**
 * Revert react-native-keyboard-controller KeyboardAvoidingView back to
 * React Native's built-in KeyboardAvoidingView in all affected screens.
 *
 * react-native-keyboard-controller requires a native module that is NOT
 * available in Expo Go — it crashes with:
 *   "_bindings.KeyboardControllerNative.getConstants is not a function"
 *
 * Instead we will use the built-in KAV with behavior="padding" on all platforms
 * (previously some screens used "height" on Android which was wrong).
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");

const APP_DIR = path.join(__dirname, "..", "app");

function getAllTsxFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function fixFile(filePath) {
  let src = fs.readFileSync(filePath, "utf8");

  if (!src.includes("react-native-keyboard-controller")) return false;

  let changed = false;

  // ── Pattern: import { KeyboardAvoidingView } from "react-native-keyboard-controller";
  // Remove this line and add KeyboardAvoidingView back to the react-native import
  if (src.includes('from "react-native-keyboard-controller"') || src.includes("from 'react-native-keyboard-controller'")) {
    // Remove the RNKC import line (handles aliased imports too)
    src = src.replace(
      /\nimport\s*\{[^}]*KeyboardAvoidingView[^}]*\}\s*from\s*["']react-native-keyboard-controller["'];?/g,
      ""
    );

    // Also handle KeyboardProvider import in _layout.tsx
    src = src.replace(
      /\nimport\s*\{[^}]*KeyboardProvider[^}]*\}\s*from\s*["']react-native-keyboard-controller["'];?/g,
      ""
    );

    // Remove KeyboardProvider wrapper tags from _layout.tsx
    src = src.replace(/\s*<KeyboardProvider[^>]*>/g, "");
    src = src.replace(/\s*<\/KeyboardProvider>/g, "");

    // Add KeyboardAvoidingView back to the react-native import if it was removed
    // Check if KeyboardAvoidingView is used in the file but not in the RN import
    if (
      src.includes("KeyboardAvoidingView") &&
      !src.match(/KeyboardAvoidingView[^"'].*from\s*["']react-native["']/) &&
      !src.match(/from\s*["']react-native["'][^;]*KeyboardAvoidingView/)
    ) {
      // Add it to the react-native import block
      src = src.replace(
        /} from ["']react-native["'];/,
        `  KeyboardAvoidingView,\n} from "react-native";`
      );
    }

    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, src, "utf8");
    return true;
  }
  return false;
}

const files = getAllTsxFiles(APP_DIR);
// Also check _layout.tsx
files.push(path.join(__dirname, "..", "app", "_layout.tsx"));

let fixedCount = 0;
const fixedFiles = [];
const seen = new Set();

for (const f of files) {
  if (seen.has(f)) continue;
  seen.add(f);
  if (fixFile(f)) {
    fixedCount++;
    fixedFiles.push(path.relative(path.join(__dirname, ".."), f));
  }
}

console.log(`Reverted ${fixedCount} files:`);
fixedFiles.forEach((f) => console.log("  ✓", f));

// Verify parse
let parseErrors = 0;
for (const f of fixedFiles) {
  const full = path.join(__dirname, "..", f);
  try {
    parse(fs.readFileSync(full, "utf8"), {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
  } catch (e) {
    console.error("PARSE ERROR in", f, ":", e.message, "line", e.loc?.line);
    parseErrors++;
  }
}

if (parseErrors === 0) {
  console.log("\nAll files parse OK ✓");
} else {
  console.error(`\n${parseErrors} files have parse errors!`);
  process.exit(1);
}
