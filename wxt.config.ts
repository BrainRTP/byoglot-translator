import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-svelte"],
  outDir: "dist",
  // AMO reviewers rebuild from the sources zip; the pnpm hook and the Node version are hidden files.
  zip: {
    includeSources: ["**/*", ".pnpmfile.cjs", ".nvmrc"],
    excludeSources: ["apple/**", "android/**", "windows/**", "linux/**"],
  },
  manifest: ({ browser }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    action: {
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        96: "icon/96.png",
        128: "icon/128.png",
      },
    },
    permissions: ["storage", "activeTab", "contextMenus"],
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    commands: {
      "translate-page": {
        suggested_key: { default: "Alt+Shift+T", mac: "Alt+A" },
        description: "__MSG_cmdTranslatePage__",
      },
      "translate-selection": {
        suggested_key: { default: "Alt+Shift+S", mac: "Alt+X" },
        description: "__MSG_cmdTranslateSelection__",
      },
      "insert-selection": {
        suggested_key: { default: "Alt+Shift+I", mac: "Alt+I" },
        description: "__MSG_cmdInsertSelection__",
      },
    },
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "byoglot-translator@brainrtp",
          // The built-in data consent needs Firefox 140.
          strict_min_version: "140.0",
          data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
        },
        gecko_android: {
          strict_min_version: "160.0",
        },
      },
    }),
  }),
});
