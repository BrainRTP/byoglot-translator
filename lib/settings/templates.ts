import { BUILTIN_TEMPLATE_ID, builtinTemplate } from "./defaults";
import type { SiteRule, Template, TemplateSettings } from "./types";

export function cloneTemplateSettings(s: TemplateSettings): TemplateSettings {
  const out: TemplateSettings = { ...s };
  if (s.pageModel) out.pageModel = { ...s.pageModel };
  if (s.selectionModel) out.selectionModel = { ...s.selectionModel };
  return out;
}

export function createTemplate(
  list: Template[],
  name: string,
  settings: TemplateSettings,
): { list: Template[]; template: Template } {
  const template: Template = {
    id: crypto.randomUUID(),
    name,
    builtin: false,
    settings: cloneTemplateSettings(settings),
  };
  return { list: [...list, template], template };
}

export function updateTemplate(
  list: Template[],
  id: string,
  patch: { name?: string; settings?: TemplateSettings },
): Template[] {
  if (!list.some((t) => t.id === id)) throw new Error(`Template not found: ${id}`);
  return list.map((t) =>
    t.id === id
      ? {
          ...t,
          name: patch.name ?? t.name,
          settings: patch.settings ? cloneTemplateSettings(patch.settings) : t.settings,
        }
      : t,
  );
}

export function duplicateTemplate(
  list: Template[],
  id: string,
  name: string,
): { list: Template[]; template: Template } {
  const source = list.find((t) => t.id === id);
  if (!source) throw new Error(`Template not found: ${id}`);
  return createTemplate(list, name, source.settings);
}

export function deleteTemplate(
  list: Template[],
  rules: SiteRule[],
  id: string,
): { list: Template[]; rules: SiteRule[] } {
  if (id === BUILTIN_TEMPLATE_ID || list.find((t) => t.id === id)?.builtin) {
    throw new Error("The built-in template cannot be deleted");
  }
  return {
    list: list.filter((t) => t.id !== id),
    rules: rules.filter((r) => r.templateId !== id),
  };
}

export function resetBuiltin(list: Template[]): Template[] {
  if (!list.some((t) => t.id === BUILTIN_TEMPLATE_ID)) return [builtinTemplate(), ...list];
  return list.map((t) => (t.id === BUILTIN_TEMPLATE_ID ? builtinTemplate() : t));
}
