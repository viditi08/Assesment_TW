import { useMemo, useState } from 'react'
import { normalizeGroqChatModelId, type AppSettings } from '../app/settings'
import { groqListModelIds } from '../lib/groq'

export function SettingsModal(props: {
  open: boolean
  settings: AppSettings
  defaults: AppSettings
  onClose: () => void
  onChange: (s: AppSettings) => void
}) {
  const [tab, setTab] = useState<'key' | 'prompts' | 'params'>('key')
  const [modelListText, setModelListText] = useState<string | null>(null)
  const [modelListError, setModelListError] = useState<string | null>(null)
  const [modelListBusy, setModelListBusy] = useState(false)
  const local = props.settings
  const dirtyKey = useMemo(() => props.settings.groqApiKey.trim().length > 0, [props.settings.groqApiKey])

  if (!props.open) return null

  return (
    <div className="tmModalBackdrop" role="dialog" aria-modal="true">
      <div className="tmModal">
        <div className="tmModalHeader">
          <div className="tmPanelTitle">Settings</div>
          <div className="tmModalHeaderRight">
            <button className="tmButton" onClick={() => props.onChange(props.defaults)}>
              Reset defaults
            </button>
            <button className="tmButton tmButtonPrimary" onClick={props.onClose}>
              Done
            </button>
          </div>
        </div>

        <div className="tmTabs">
          <button className={tab === 'key' ? 'tmTab tmTabActive' : 'tmTab'} onClick={() => setTab('key')}>
            API key
          </button>
          <button
            className={tab === 'prompts' ? 'tmTab tmTabActive' : 'tmTab'}
            onClick={() => setTab('prompts')}
          >
            Prompts
          </button>
          <button
            className={tab === 'params' ? 'tmTab tmTabActive' : 'tmTab'}
            onClick={() => setTab('params')}
          >
            Parameters
          </button>
        </div>

        <div className="tmModalBody">
          {tab === 'key' ? (
            <div className="tmForm">
              <label className="tmLabel">
                Groq API key
                <input
                  className="tmInput"
                  value={local.groqApiKey}
                  onChange={(e) => props.onChange({ ...local, groqApiKey: e.target.value })}
                  placeholder="gsk_…"
                />
              </label>
              <label className="tmLabel">
                Chat model (Groq id)
                <input
                  className="tmInput"
                  value={local.groqChatModel}
                  onChange={(e) => props.onChange({ ...local, groqChatModel: e.target.value })}
                  onBlur={() =>
                    props.onChange({ ...local, groqChatModel: normalizeGroqChatModelId(local.groqChatModel) })
                  }
                  placeholder="llama-3.3-70b-versatile"
                />
              </label>
              <div className="tmSubtleSmall">
                Used for live suggestions + chat. Must match an id from Groq (use List models). Default:{' '}
                <code className="tmInlineCode">llama-3.3-70b-versatile</code>. For GPT-OSS use{' '}
                <code className="tmInlineCode">openai/gpt-oss-120b</code> (never <code className="tmInlineCode">gpt-oss-120b</code> alone).
              </div>
              <div className="tmRow">
                <button
                  type="button"
                  className="tmButton"
                  disabled={!dirtyKey || modelListBusy}
                  onClick={() => {
                    setModelListError(null)
                    setModelListText(null)
                    setModelListBusy(true)
                    void groqListModelIds(local.groqApiKey.trim())
                      .then((ids) => {
                        setModelListText(ids.join('\n'))
                      })
                      .catch((e: unknown) => {
                        setModelListError(e instanceof Error ? e.message : String(e))
                      })
                      .finally(() => setModelListBusy(false))
                  }}
                >
                  {modelListBusy ? 'Loading…' : 'List models for this key'}
                </button>
              </div>
              {modelListError ? <div className="tmErrorSmall">{modelListError}</div> : null}
              {modelListText ? (
                <label className="tmLabel">
                  Models (copy one into Chat model)
                  <textarea className="tmTextarea" rows={8} readOnly value={modelListText} />
                </label>
              ) : null}
              <div className="tmSubtleSmall">
                Stored locally in your browser (localStorage). {dirtyKey ? 'Key set.' : 'Key not set.'}
              </div>
            </div>
          ) : null}

          {tab === 'prompts' ? (
            <div className="tmForm">
              <label className="tmLabel">
                Live suggestions prompt
                <textarea
                  className="tmTextarea"
                  rows={12}
                  value={local.suggestionsPrompt}
                  onChange={(e) => props.onChange({ ...local, suggestionsPrompt: e.target.value })}
                />
              </label>
              <label className="tmLabel">
                Expanded answer prompt (on click)
                <textarea
                  className="tmTextarea"
                  rows={8}
                  value={local.expandedPrompt}
                  onChange={(e) => props.onChange({ ...local, expandedPrompt: e.target.value })}
                />
              </label>
              <label className="tmLabel">
                Chat prompt
                <textarea
                  className="tmTextarea"
                  rows={8}
                  value={local.chatPrompt}
                  onChange={(e) => props.onChange({ ...local, chatPrompt: e.target.value })}
                />
              </label>
            </div>
          ) : null}

          {tab === 'params' ? (
            <div className="tmForm tmGrid2">
              <label className="tmLabel tmSpan2">
                GPT-OSS reasoning effort (Groq <code className="tmInlineCode">reasoning_effort</code>; ignored for
                non–GPT-OSS models)
                <select
                  className="tmInput"
                  value={local.groqReasoningEffort}
                  onChange={(e) =>
                    props.onChange({
                      ...local,
                      groqReasoningEffort: e.target.value as AppSettings['groqReasoningEffort'],
                    })
                  }
                >
                  <option value="">Off (omit)</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>

              <NumberField
                label="Transcription chunk (ms)"
                value={local.transcriptionChunkMs}
                onChange={(v) => props.onChange({ ...local, transcriptionChunkMs: v })}
                min={5_000}
                step={1_000}
              />
              <label className="tmLabel">
                Transcription language (optional)
                <input
                  className="tmInput"
                  value={local.transcriptionLanguage}
                  onChange={(e) => props.onChange({ ...local, transcriptionLanguage: e.target.value })}
                  placeholder="e.g. en"
                />
              </label>
              <NumberField
                label="Auto refresh interval (ms)"
                value={local.autoRefreshMs}
                onChange={(v) => props.onChange({ ...local, autoRefreshMs: v })}
                min={5_000}
                step={1_000}
              />
              <label className="tmLabel tmSpan2">
                Auto refresh enabled
                <select
                  className="tmInput"
                  value={local.autoRefreshEnabled ? 'yes' : 'no'}
                  onChange={(e) => props.onChange({ ...local, autoRefreshEnabled: e.target.value === 'yes' })}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label className="tmLabel tmSpan2">
                Whisper prompt (optional)
                <textarea
                  className="tmTextarea"
                  rows={3}
                  value={local.transcriptionPrompt}
                  onChange={(e) => props.onChange({ ...local, transcriptionPrompt: e.target.value })}
                  placeholder="Optional terms/names to bias transcription"
                />
              </label>

              <NumberField
                label="Suggestions context chars"
                value={local.suggestionsContextChars}
                onChange={(v) => props.onChange({ ...local, suggestionsContextChars: v })}
                min={1000}
                step={500}
              />
              <NumberField
                label="Expanded answer context chars"
                value={local.expandedContextChars}
                onChange={(v) => props.onChange({ ...local, expandedContextChars: v })}
                min={1000}
                step={500}
              />
              <NumberField
                label="Chat context chars"
                value={local.chatContextChars}
                onChange={(v) => props.onChange({ ...local, chatContextChars: v })}
                min={1000}
                step={500}
              />

              <NumberField
                label="Suggestions temperature"
                value={local.suggestionsTemperature}
                onChange={(v) => props.onChange({ ...local, suggestionsTemperature: v })}
                min={0}
                max={1.5}
                step={0.1}
              />
              <NumberField
                label="Suggestions max tokens"
                value={local.suggestionsMaxTokens}
                onChange={(v) => props.onChange({ ...local, suggestionsMaxTokens: v })}
                min={100}
                step={50}
              />
              <NumberField
                label="Expanded temperature"
                value={local.expandedTemperature}
                onChange={(v) => props.onChange({ ...local, expandedTemperature: v })}
                min={0}
                max={1.5}
                step={0.1}
              />
              <NumberField
                label="Expanded max tokens"
                value={local.expandedMaxTokens}
                onChange={(v) => props.onChange({ ...local, expandedMaxTokens: v })}
                min={100}
                step={50}
              />
              <NumberField
                label="Chat temperature"
                value={local.chatTemperature}
                onChange={(v) => props.onChange({ ...local, chatTemperature: v })}
                min={0}
                max={1.5}
                step={0.1}
              />
              <NumberField
                label="Chat max tokens"
                value={local.chatMaxTokens}
                onChange={(v) => props.onChange({ ...local, chatMaxTokens: v })}
                min={100}
                step={50}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function NumberField(props: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="tmLabel">
      {props.label}
      <input
        className="tmInput"
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

