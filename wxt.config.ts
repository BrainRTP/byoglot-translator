import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-svelte"],
  outDir: "dist",
  manifest: {
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
    commands: {
      "translate-page": {
        suggested_key: { default: "Alt+Shift+T", mac: "Alt+A" },
        description: "__MSG_cmdTranslatePage__",
      },
      "translate-selection": {
        suggested_key: { default: "Alt+Shift+S", mac: "Alt+X" },
        description: "__MSG_cmdTranslateSelection__",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: "opencode-translator@local",
        data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
      },
    },
  },
});
