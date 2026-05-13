/**
 * Batch-replace React Native's built-in KeyboardAvoidingView with
 * react-native-keyboard-controller's version in all affected screens.
 *
 * Pattern 1: KeyboardAvoidingView is in the react-native import block
 * Pattern 2: behavior="ios ? padding : height" → behavior="padding" (RNKC always uses padding)
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");

const APP_DIR = path.join(__dirname, "..", "app");

// Files already fixed (skip these)
const ALREADY_FIXED = new Set([
  "client-message-thread-business.tsx",
  "client-message-thread.tsx",
]);

function getAllTsxFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTsxFiles(full));
    } else if (entry.name.endsWith(".tsx") && !ALREADY_FIXED.has(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function fixFile(filePath) {
  let src = fs.readFileSync(filePath, "utf8");

  // Check if this file uses KeyboardAvoidingView from react-native
  if (!src.includes("KeyboardAvoidingView")) return false;
  if (src.includes("react-native-keyboard-controller")) return false; // already fixed

  let changed = false;

  // ── Pattern A: KeyboardAvoidingView is the only item from react-native on its own line ──
  // e.g.  KeyboardAvoidingView,\n
  // Remove it from the RN import and add RNKC import after the react-native import block

  // Remove from react-native import (handles both comma-first and comma-last styles)
  const rnImportRegex = /(from\s+["']react-native["'])/;
  if (rnImportRegex.test(src) && src.includes("KeyboardAvoidingView")) {
    // Remove KeyboardAvoidingView from the react-native import destructure
    // Handle: "  KeyboardAvoidingView,\n" or ",\n  KeyboardAvoidingView" or "KeyboardAvoidingView, " etc.
    src = src
      // Remove as standalone line with trailing comma
      .replace(/\n\s*KeyboardAvoidingView,(\s*\n)/g, "$1")
      // Remove as standalone line without trailing comma (last item)
      .replace(/,\n\s*KeyboardAvoidingView(\s*\n)/g, "$1")
      // Remove inline with trailing comma
      .replace(/KeyboardAvoidingView,\s*/g, "")
      // Remove inline with leading comma
      .replace(/,\s*KeyboardAvoidingView/g, "");

    // Add RNKC import right after the react-native import block
    src = src.replace(
      /} from ["']react-native["'];/,
      `} from "react-native";\nimport { KeyboardAvoidingView } from "react-native-keyboard-controller";`
    );

    changed = true;
  }

  // ── Pattern B: Fix behavior prop ──
  // behavior={Platform.OS === "ios" ? "padding" : "height"} → behavior="padding"
  // behavior={Platform.OS === 'ios' ? 'padding' : 'height'} → behavior="padding"
  // behavior={Platform.OS === "ios" ? "padding" : undefined} → behavior="padding"
  src = src.replace(
    /behavior=\{Platform\.OS\s*===\s*["']ios["']\s*\?\s*["']padding["']\s*:\s*(?:["']height["']|undefined)\}/g,
    `behavior="padding"`
  );

  if (changed) {
    fs.writeFileSync(filePath, src, "utf8");
    return true;
  }
  return false;
}

const files = getAllTsxFiles(APP_DIR);
let fixedCount = 0;
const fixedFiles = [];

for (const f of files) {
  if (fixFile(f)) {
    fixedCount++;
    fixedFiles.push(path.relative(APP_DIR, f));
  }
}

console.log(`Fixed ${fixedCount} files:`);
fixedFiles.forEach((f) => console.log("  ✓", f));

// Verify all fixed files parse correctly
let parseErrors = 0;
for (const f of fixedFiles) {
  const full = path.join(APP_DIR, f);
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
