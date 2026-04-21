import type { SuggestionBatch, SuggestionCard } from '../domain/suggestions'

export function SuggestionsPanel(props: {
  batches: SuggestionBatch[]
  hasTranscript: boolean
  onClickSuggestion: (s: SuggestionCard) => void
  onReload: () => void
  isReloading: boolean
  /** Seconds until next auto-refresh, or null if auto is off */
  autoRefreshCountdownSec: number | null
  /** Interval in seconds (for copy in callout) */
  autoRefreshIntervalSec: number
  hasKey: boolean
}) {
  const n = props.batches.length
  const batchLabel =
    n === 0 ? '0 batches' : n === 1 ? '1 batch' : `${n} batches`

  return (
    <div className="tmPanel">
      <div className="tmPanelHeader">
        <div className="tmPanelTitle tmPanelTitleCaps">2. Live suggestions</div>
        <div className="tmPill tmPillStrong">{batchLabel}</div>
      </div>

      <div className="tmScroll">
        <div className="tmSuggestToolbar">
          <button
            type="button"
            className="tmButton tmReloadBtn"
            onClick={() => props.onReload()}
            disabled={!props.hasKey || props.isReloading}
            title="Flush current audio segment, then refresh suggestions"
          >
            <span className="tmReloadGlyph" aria-hidden>
              ↻
            </span>
            {props.isReloading ? 'Reloading…' : 'Reload suggestions'}
          </button>
          {props.autoRefreshCountdownSec != null ? (
            <span className="tmCountdown">auto-refresh in {props.autoRefreshCountdownSec}s</span>
          ) : (
            <span className="tmCountdown tmCountdownOff">auto-refresh off</span>
          )}
        </div>

        <div className="tmCallout tmCalloutAccent">
          On reload (or auto every ~{props.autoRefreshIntervalSec}s), generate 3 fresh suggestions from recent
          transcript context. New batch appears at the top; older batches push down (faded). Each is a tappable card:
          a question to ask, a talking point, an answer, or a fact-check. The preview alone should already be useful.
        </div>

        {props.batches.length === 0 ? (
          <div className="tmEmpty">
            {props.hasKey
              ? 'Turn the mic on — suggestions update right after each new transcript line (and on the timer while you listen). Reload is optional.'
              : 'Add a Groq API key in Settings first.'}
          </div>
        ) : (
          <div className="tmList tmBatches">
            {props.batches.map((b, batchIndex) => {
              const batchNum = props.batches.length - batchIndex
              const time = new Date(b.createdAt).toLocaleTimeString()
              return (
                <div key={b.id} className={batchIndex === 0 ? 'tmBatch' : 'tmBatch tmBatchOlder'}>
                  <div className="tmSuggestionGrid">
                    {b.suggestions.map((s) => (
                      <button
                        key={s.id}
                        className="tmSuggestionCard"
                        onClick={() => props.onClickSuggestion(s)}
                        title="Open detailed answer in chat"
                      >
                        <div className="tmSuggestionTop">
                          <div className={typePillClass(s.type)}>{labelTypeUpper(s.type)}</div>
                          <div className="tmSuggestionTitle">{s.title}</div>
                        </div>
                        <div className="tmSuggestionPreview">{s.preview}</div>
                      </button>
                    ))}
                  </div>
                  <div className="tmBatchFooter">
                    — BATCH {batchNum} · {time} —
                  </div>
                  <div className="tmBatchMetaRow">{batchTranscriptLabel(b.basedOnChunkId, props.hasTranscript)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function typePillClass(t: SuggestionCard['type']): string {
  const base = 'tmSuggestionTypeTag'
  switch (t) {
    case 'question':
      return `${base} tmTagQuestion`
    case 'talking_point':
      return `${base} tmTagTalking`
    case 'answer':
      return `${base} tmTagAnswer`
    case 'fact_check':
      return `${base} tmTagFact`
    case 'clarify':
      return `${base} tmTagClarify`
    default:
      return `${base} tmTagClarify`
  }
}

function labelTypeUpper(t: SuggestionCard['type']): string {
  switch (t) {
    case 'question':
      return 'Question to ask'
    case 'talking_point':
      return 'Talking point'
    case 'answer':
      return 'Answer'
    case 'fact_check':
      return 'Fact-check'
    case 'clarify':
      return 'Clarify'
    default:
      return 'Suggestion'
  }
}

function batchTranscriptLabel(basedOnChunkId: string | null | undefined, hasTranscript: boolean): string {
  if (basedOnChunkId) return 'Grounded in transcript'
  if (hasTranscript) return 'Stale batch — reload to use current transcript'
  return 'No transcript when this batch ran'
}
