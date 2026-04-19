import type { SuggestionBatch, SuggestionCard } from '../domain/suggestions'

export function SuggestionsPanel(props: {
  batches: SuggestionBatch[]
  onClickSuggestion: (s: SuggestionCard) => void
}) {
  return (
    <div className="tmPanel">
      <div className="tmPanelHeader">
        <div className="tmPanelTitle">Live suggestions</div>
        <div className="tmSubtleSmall">{props.batches.length ? 'Newest at top' : ''}</div>
      </div>

      <div className="tmScroll">
        {props.batches.length === 0 ? (
          <div className="tmEmpty">
            Suggestions will refresh every ~30 seconds (and you can tap Refresh).
          </div>
        ) : (
          <div className="tmList tmBatches">
            {props.batches.map((b) => (
              <div key={b.id} className="tmBatch">
                <div className="tmBatchHeader">
                  <div className="tmBatchTime">
                    {new Date(b.createdAt).toLocaleTimeString()}
                  </div>
                  <div className="tmMeta">
                    {b.basedOnChunkId ? 'Based on latest transcript' : 'No transcript yet'}
                  </div>
                </div>
                <div className="tmSuggestionGrid">
                  {b.suggestions.map((s) => (
                    <button
                      key={s.id}
                      className="tmSuggestionCard"
                      onClick={() => props.onClickSuggestion(s)}
                      title="Open detailed answer in chat"
                    >
                      <div className="tmSuggestionTop">
                        <div className="tmSuggestionType">{labelType(s.type)}</div>
                        <div className="tmSuggestionTitle">{s.title}</div>
                      </div>
                      <div className="tmSuggestionPreview">{s.preview}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function labelType(t: SuggestionCard['type']) {
  switch (t) {
    case 'question':
      return 'Question'
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

