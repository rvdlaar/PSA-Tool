// PSA Templates - Professional Services Automation templates

export interface PSATemplate {
  id: string;
  name: string;
  category: string;
  content: string;
  variables: string[];
}

export const templates: PSATemplate[] = [
  {
    id: 'project-proposal',
    name: 'Project Proposal',
    category: 'sales',
    content: 'Project Proposal Template',
    variables: ['clientName', 'projectName', 'budget', 'timeline']
  },
  {
    id: 'sow',
    name: 'Statement of Work',
    category: 'legal',
    content: 'Statement of Work Template',
    variables: ['projectScope', 'deliverables', 'timeline', 'paymentTerms']
  },
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    category: 'operations',
    content: 'Meeting Notes Template',
    variables: ['attendees', 'date', 'actionItems', 'decisions']
  }
];

export function getTemplate(id: string): PSATemplate | undefined {
  return templates.find(t => t.id === id);
}

export function listTemplates(category?: string): PSATemplate[] {
  if (category) {
    return templates.filter(t => t.category === category);
  }
  return templates;
}
