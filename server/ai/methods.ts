// Pipeline Methods Registry — how data is prepared between trigger and skill

import type { SkillConfigField } from './skills/registry'

export interface PipelineMethod {
  id: string
  name: string
  description: string
  icon: string
  compatibleTriggers: string[]
  outputType: 'audio' | 'image' | 'text' | 'any'
  config?: {
    fields: SkillConfigField[]
  }
}

export const PIPELINE_METHODS: PipelineMethod[] = [
  {
    id: 'pass_content',
    name: 'Pass as-is',
    description: 'Forward trigger content directly',
    icon: '\u{1F4E8}',
    compatibleTriggers: ['on_audio', 'on_image', 'on_message', 'on_keyword', 'on_message_from'],
    outputType: 'any',
  },
  {
    id: 'last_n_messages',
    name: 'Last N messages',
    description: 'Collect recent chat messages',
    icon: '\u{1F4DC}',
    compatibleTriggers: ['on_message', 'on_keyword', 'on_message_from', 'on_schedule'],
    outputType: 'text',
    config: {
      fields: [
        { key: 'count', label: 'Messages', type: 'number', defaultValue: 20, min: 5, max: 100 },
      ],
    },
  },
  {
    id: 'last_audio',
    name: 'Last audio',
    description: 'Get the most recent audio message',
    icon: '\u{1F3B5}',
    compatibleTriggers: ['on_audio', 'on_message', 'on_keyword'],
    outputType: 'audio',
  },
  {
    id: 'last_image',
    name: 'Last image',
    description: 'Get the most recent image',
    icon: '\u{1F5BC}\u{FE0F}',
    compatibleTriggers: ['on_image', 'on_message', 'on_keyword'],
    outputType: 'image',
  },
  {
    id: 'collect_from_channels',
    name: 'From channels',
    description: 'Aggregate messages from selected channels',
    icon: '\u{1F4F0}',
    compatibleTriggers: ['on_schedule'],
    outputType: 'text',
    config: {
      fields: [
        { key: 'maxMessages', label: 'Max messages', type: 'number', defaultValue: 50, min: 10, max: 200 },
      ],
    },
  },
]

export function getMethodById(methodId: string): PipelineMethod | undefined {
  return PIPELINE_METHODS.find(m => m.id === methodId)
}

export function getMethodsForTrigger(triggerEvent: string): PipelineMethod[] {
  return PIPELINE_METHODS.filter(m => m.compatibleTriggers.includes(triggerEvent))
}
