import { INTELLIGENT_UI_LANGUAGE } from "./schema";

export type VisualLayout = "rich" | "simple";

export const visualLayouts = ["rich", "simple"] as const satisfies readonly VisualLayout[];

const COMPONENT_REFERENCE = [
  'chart: {"type":"chart","kind":"bar"|"line"|"area"|"pie"|"donut","title"?,"labels":[string],"series":[{"name":string,"values":[number]}],"stacked"?:boolean,"valuePrefix"?:"$","valueSuffix"?:"%"}. One value per label in every series; at most 6 series and 48 labels. pie/donut use only the first series and need non-negative values. Never put two measures with different units in one chart.',
  'stats: {"type":"stats","items":[{"label":string,"value":string|number,"change"?:"+12%","sentiment"?:"positive"|"negative"|"neutral","detail"?:string}]} (1-6 headline numbers).',
  'checklist: {"type":"checklist","title"?,"items":[{"label":string,"detail"?:string,"checked"?:boolean}]} — the user can tick items; their ticks are remembered.',
  'actions: {"type":"actions","items":[{"label":string, and exactly one of "prompt":string (sent as the user\'s next message), "copy":string (copied to the clipboard), "url":"https://..."}]} (1-6 buttons).',
  'calculator: {"type":"calculator","title"?,"inputs":[{"id":"guests","label":string,"control":"number"|"slider"|"stepper"|"select","value":number,"min"?,"max"?,"step"?,"unit"?,"options"?:[{"label":string,"value":number}]}],"outputs":[{"label":string,"formula":"total / guests","format"?:"number"|"currency"|"percent","currency"?:"USD","decimals"?:number,"unit"?:string,"highlight"?:boolean}]}. Formulas may use input ids, numbers, + - * / % ^, comparisons, && || !, cond ? a : b, pi, and min max round(x,digits) floor ceil abs sqrt pow log log10 exp clamp. "percent" formats 0.15 as 15%. Outputs update live as inputs change.',
  'timeline: {"type":"timeline","title"?,"items":[{"title":string,"time"?:string,"detail"?:string,"status"?:"done"|"current"|"upcoming"}]} for steps, schedules, and histories.',
  'comparison: {"type":"comparison","columns":[{"name":string,"badge"?:string,"summary"?:string,"highlight"?:boolean}],"rows":[{"label":string,"values":[string|number|boolean|null]}]} for 2-4 options side by side; booleans show as check marks.',
  'table: {"type":"table","columns":[string],"rows":[[string|number|boolean|null]]} for sortable data (use Markdown tables for small static ones).',
  'cards: {"type":"cards","items":[{"title":string,"subtitle"?,"description"?,"badge"?,"prompt"?:string,"url"?:"https://..."}]} for recommendations; a card with a prompt sends it when tapped.',
  'tabs: {"type":"tabs","tabs":[{"label":string,"content":"Markdown"}]} (2-8 tabs) to explore parts, options, or levels of detail without a wall of text.',
  'form: {"type":"form","fields":[{"id":string,"label":string,"input":"text"|"textarea"|"number"|"select","options"?:[string],"placeholder"?,"required"?:boolean}],"submitLabel"?:string,"prompt":"Plan a {days}-day trip to {city}"}; on submit, {id} placeholders are filled and the prompt is sent as the user\'s next message.',
  'quiz: {"type":"quiz","questions":[{"question":string,"choices":[string],"answer":0,"explanation"?:string}]} for practice and games; answer is the zero-based index of the correct choice.',
].join(" ");

/**
 * The system prompt section that teaches the model to write Intelligent UI
 * blocks. Kept out of comparisons, which render answers without the actions
 * these components depend on.
 */
export function buildIntelligentUiInstruction(layout: VisualLayout): string {
  const fence = "```" + INTELLIGENT_UI_LANGUAGE;
  const usage =
    layout === "simple"
      ? `The user prefers simple, text-first answers. Use a ${fence} block only when the user explicitly asks for a chart, calculator, checklist, quiz, or other interactive element.`
      : `Choose the format that serves the question best. Use ${fence} blocks when a visual or interactive element is clearly more useful than prose — numeric data or trends (chart, stats), tasks to track (checklist), steps or schedules (timeline), weighing options (comparison, cards), quantities the user may want to adjust (calculator), structured input (form), learning (quiz), or likely next steps (actions). Plain Markdown is still the right answer for most conversational, short, or purely explanatory replies; do not add components for decoration, and use at most a few per answer.`;

  return [
    "Intelligent UI:",
    `You can embed native interactive components in your Markdown answer by writing a fenced code block with the language \`${INTELLIGENT_UI_LANGUAGE}\` that contains exactly one JSON object (strict JSON: double quotes, no comments, no trailing commas).`,
    usage,
    'Keep the explanation in normal Markdown around the blocks, put each block where it belongs in the answer, never wrap a block in another code block, and never mention the JSON or the block syntax to the user. Use the user\'s language for all labels. Every component accepts optional "title" and "description". Components:',
    COMPONENT_REFERENCE,
    `Example: ${fence}\n{"type":"chart","kind":"line","title":"Monthly visitors","labels":["Jan","Feb","Mar"],"series":[{"name":"Visitors","values":[1200,1850,2400]}]}\n\`\`\``,
  ].join(" ");
}
