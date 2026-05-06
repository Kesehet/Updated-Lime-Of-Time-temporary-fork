// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "space.manus.manus.scheduler.t20260406102824";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";

// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "Lime Of Time",
  appSlug: "manus-scheduler",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl:
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663347678319/rvonQNLXSNYbyBpY.png",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.12",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,

  extra: {
    eas: {
      projectId: "031e5de6-3a21-4c81-97b3-e50ec17148ac",
    },
  },

  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#F0FFF0",
      dark: {
        image: "./assets/images/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#1a2e1a",
      },
    },
  },

  android: {
    adaptiveIcon: {
      backgroundColor: "#F0FFF0",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },

  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },

  plugins: [
    "expo-router",
    [
      "expo-image-picker",
      {
        "photosPermission": "Allow $(PRODUCT_NAME) to access your photos for client before/after gallery.",
        "cameraPermission": "Allow $(PRODUCT_NAME) to take photos for client before/after gallery."
      }
    ],
    [
      "expo-contacts",
      {
        contactsPermission:
          "Allow $(PRODUCT_NAME) to access your contacts to import clients.",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission:
          "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 280,
        resizeMode: "contain",
        backgroundColor: "#F0FFF0",
        dark: {
          backgroundColor: "#1a2e1a",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          ndkVersion: "27.2.12479018",
        },
      },
    ],
    [
      "./plugins/withMinSdkVersion",
      {
        minSdkVersion: 24,
        ndkVersion: "27.2.12479018",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/notification-icon.png",
        color: "#4a8c3f",
        defaultChannel: "appointments",
        sounds: [],
      },
    ],
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "Allow $(PRODUCT_NAME) to use Face ID to unlock the app.",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "Allow $(PRODUCT_NAME) to use your location to find nearby businesses.",
        locationWhenInUsePermission:
          "Allow $(PRODUCT_NAME) to use your location to find nearby businesses.",
      },
    ],
    [
      "expo-calendar",
      {
        calendarPermission: "Allow $(PRODUCT_NAME) to access your calendar to add appointments.",
        remindersPermission: "Allow $(PRODUCT_NAME) to access your reminders.",
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;