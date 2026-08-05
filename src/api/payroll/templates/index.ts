import { SheetTemplate } from './engine';
import { medfinTemplate } from './medfin';
import { akshaTemplate } from './aksha';
import { bankAdviceTemplate } from './bankAdvice';

// Registry of payroll sheet templates. Add a new org format here.
export const SHEET_TEMPLATES: SheetTemplate[] = [medfinTemplate, akshaTemplate, bankAdviceTemplate];

export const DEFAULT_TEMPLATE_ID = medfinTemplate.id;

export function getTemplate(id?: string): SheetTemplate {
  return SHEET_TEMPLATES.find(t => t.id === id) ?? medfinTemplate;
}

// Lightweight list for the frontend dropdown.
export function listTemplates() {
  return SHEET_TEMPLATES.map(t => ({ id: t.id, label: t.label, modes: t.modes }));
}
