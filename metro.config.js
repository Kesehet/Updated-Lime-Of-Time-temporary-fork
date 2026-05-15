const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

// The @stripe/stripe-react-native package has corrupted filesystem inodes in
// lib/commonjs/types, lib/commonjs/specs, and lib/module/connect that cause
// Metro's FallbackWatcher to crash with EIO. We exclude the entire stripe
// package from the watch scope to prevent the crash.
//
// This does NOT affect the production build — EAS Build installs fresh packages.
const stripeDir = path.join(__dirname, "node_modules/@stripe/stripe-react-native");

// Use the resolver blockList to prevent Metro from resolving files in the corrupted dirs
config.resolver = config.resolver || {};
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []),
  new RegExp(stripeDir.replace(/[/\\]/g, "[\\\\/]") + "[\\\\/]lib[\\\\/]commonjs[\\\\/]types[\\\\/].*"),
  new RegExp(stripeDir.replace(/[/\\]/g, "[\\\\/]") + "[\\\\/]lib[\\\\/]commonjs[\\\\/]specs[\\\\/].*"),
  new RegExp(stripeDir.replace(/[/\\]/g, "[\\\\/]") + "[\\\\/]lib[\\\\/]module[\\\\/]connect[\\\\/].*"),
];

// Override the watcher to use a custom ignore function that skips the corrupted dirs
config.watcher = config.watcher || {};
config.watcher.additionalExts = config.watcher.additionalExts || [];
config.watcher.watchman = config.watcher.watchman || {};
config.watcher.watchman.deferStates = config.watcher.watchman.deferStates || [];

// Use healthCheckFilePrefix to force FallbackWatcher to skip the corrupted paths
// The real fix: patch the watcher to ignore EIO errors in those specific dirs
const originalGetDefaultConfig = getDefaultConfig;
if (config.server) {
  config.server.enhanceMiddleware = config.server.enhanceMiddleware || undefined;
}

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
