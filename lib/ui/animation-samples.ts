import type { Sample } from "./animation-demo";

// <x1>..</x1> marks the link, the same placeholder the page translator uses
export const PREVIEW: Sample = [
  { tag: "span", cls: "l-h", en: "Getting started", ru: "Начало работы" },
  {
    tag: "span",
    cls: "l-p",
    en: "Install the extension and connect it.",
    ru: "Установите расширение и подключите его.",
  },
];

export const SCENE: Sample = [
  { tag: "h3", en: "Getting started", ru: "Начало работы" },
  {
    tag: "p",
    en: "The extension translates the page with the model you picked, one block at a time. See the <x1>setup guide</x1> if the connection fails.",
    ru: "Расширение переводит страницу выбранной вами моделью, блок за блоком. Если подключение не удается, откройте <x1>руководство по настройке</x1>.",
  },
  {
    tag: "li",
    en: "Open any page and click the extension icon.",
    ru: "Откройте любую страницу и нажмите на значок расширения.",
  },
  {
    tag: "li",
    en: "Choose a model and a template in the settings.",
    ru: "Выберите модель и шаблон в настройках.",
  },
];
