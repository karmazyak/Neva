// Skill Registry — declarative system of agent capabilities
// Each skill has a command, cost, and execute function

export interface SkillConfigField {
  key: string           // 'language', 'variants', 'maxMessages'
  label: string         // display name
  type: 'text' | 'number' | 'select' | 'toggle'
  placeholder?: string
  options?: { label: string; value: string }[]  // for select
  defaultValue?: any
  min?: number          // for number
  max?: number          // for number
}

export interface SkillConfigSchema {
  needsSystemPrompt: boolean   // show system prompt textarea
  needsModel: boolean          // show model selector
  needsTemperature: boolean    // show temperature slider
  fields: SkillConfigField[]   // custom fields for this skill
}

export interface SkillContext {
  chatId: string
  userId: string
  prompt: string
  agentModel: string
  chatHistory?: { role: 'user' | 'assistant'; content: string }[]
  skillSettings?: Record<string, any>  // custom settings from user
  outputMode?: 'ghost' | 'normal'  // pipeline output mode override
}

export interface SkillResult {
  content: string
  type: 'text' | 'image'
  visibility?: 'normal' | 'ghost'
  metadata?: Record<string, any>
}

export interface Skill {
  id: string
  command: string        // e.g. '/image', '/translate'
  name: string
  description: string
  icon: string           // emoji for UI
  cost: number           // credits per use
  isAutoTrigger: boolean // true = can be triggered by incoming messages (auto-reply)
  inputType: 'audio' | 'image' | 'text' | 'any'  // for pipeline smart filtering
  configSchema: SkillConfigSchema
  inputDescription: string   // what the skill accepts
  outputDescription: string  // what the skill returns
  execute: (ctx: SkillContext) => Promise<SkillResult>
}

// Skill info for UI (without execute function, with optional agent context)
export interface SkillInfo {
  id: string
  command: string
  name: string
  description: string
  icon: string
  cost: number
  isAutoTrigger: boolean
  inputType: 'audio' | 'image' | 'text' | 'any'
  configSchema?: SkillConfigSchema
  inputDescription: string
  outputDescription: string
  agentId?: string
  agentName?: string
  agentAvatar?: string
  customCommand?: string  // user's custom alias
}

// Import all skill implementations
import { imageSkill } from './image'
import { translateSkill } from './translate'
import { summarizeSkill } from './summarize'
import { searchSkill } from './search'
import { textReplySkill } from './text-reply'
import { sttSkill } from './stt'
import { styleReplySkill } from './style-reply'

// All available skills
export const SKILLS: Record<string, Skill> = {
  text_reply: textReplySkill,
  image_generate: imageSkill,
  translate: translateSkill,
  summarize: summarizeSkill,
  web_search: searchSkill,
  stt: sttSkill,
  style_reply: styleReplySkill,
}

// Find skill by /command
export function findSkillByCommand(command: string): Skill | undefined {
  return Object.values(SKILLS).find(s => s.command === command)
}

// Find skill by ID
export function findSkillById(skillId: string): Skill | undefined {
  return SKILLS[skillId]
}

// Get list of skills for UI (autocomplete, agent builder) — includes configSchema
export function getSkillList(): Omit<Skill, 'execute'>[] {
  return Object.values(SKILLS).map(({ execute, ...rest }) => rest)
}

// Get skills that an agent has (based on tools array)
export function getAgentSkills(tools: string[]): Skill[] {
  if (!tools || tools.length === 0) {
    // Default: text_reply only
    return [SKILLS.text_reply]
  }
  return tools
    .map(t => SKILLS[t])
    .filter(Boolean)
}
