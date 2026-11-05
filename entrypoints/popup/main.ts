import { mount } from "svelte";
import "../../lib/ui/tokens.css";
import { changeUiLang } from "../../lib/ui/i18n.svelte";
import { applyTheme, recallLook } from "../../lib/ui/theme";
import App from "./App.svelte";

const look = recallLook();
if (look) {
  changeUiLang(look.uiLang);
  applyTheme(document.documentElement, look.theme);
}

const target = document.getElementById("app");
if (!target) throw new Error("popup root not found");

export default mount(App, { target });
