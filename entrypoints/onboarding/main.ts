import { mount } from "svelte";
import "../../lib/ui/tokens.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("onboarding root not found");

export default mount(App, { target });
