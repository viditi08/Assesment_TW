export type SuggestionType =
  | 'question'
  | 'talking_point'
  | 'answer'
  | 'fact_check'
  | 'clarify'

export type SuggestionCard = {
  id: string
  type: SuggestionType
  title: string
  preview: string
  expandPrompt: string
}

export type SuggestionBatch = {
  id: string
  createdAt: string
  basedOnChunkId: string | null
  suggestions: SuggestionCard[]
}

