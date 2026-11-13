import { mount } from "svelte";
import "../../lib/ui/tokens.css";
import "../../lib/ui/options.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("translator root not found");

export default mount(App, { target });
