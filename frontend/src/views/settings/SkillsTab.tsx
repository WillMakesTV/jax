import clsx from 'clsx'
import {Check, ChevronDown, ChevronRight, RotateCcw} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  ListAppSkills,
  ResetAppSkill,
  SaveAppSkill,
} from '../../../wailsjs/go/main/App'
import {main} from '../../../wailsjs/go/models'
import {MarkdownField} from '../../components/markdown/MarkdownField'

/**
 * Settings → Skills: the Application Skills catalog. Each skill is an
 * instruction document (shipped as an embedded default) teaching how to use
 * one feature area; Claude reads them over MCP via list_skills/get_skill.
 * Editing a skill stores an override; resetting restores the default.
 */
export function SkillsTab() {
  const [skills, setSkills] = useState<main.AppSkill[] | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Unsaved edits per skill id; absent means the stored content is shown.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)
  // Reset asks for a second click; holds the armed skill id.
  const [resetArmed, setResetArmed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ListAppSkills()
      .then((list) => {
        if (!cancelled) setSkills(list)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const replaceSkill = (updated: main.AppSkill) =>
    setSkills((list) =>
      (list ?? []).map((s) => (s.id === updated.id ? updated : s)),
    )

  const save = async (skill: main.AppSkill) => {
    const draft = drafts[skill.id]
    if (draft === undefined) return
    try {
      const updated = await SaveAppSkill(skill.id, draft)
      replaceSkill(updated)
      setDrafts(({[skill.id]: _dropped, ...rest}) => rest)
      setSavedId(skill.id)
      setError('')
    } catch (err) {
      setError(String(err))
    }
  }

  const reset = async (skill: main.AppSkill) => {
    try {
      const updated = await ResetAppSkill(skill.id)
      replaceSkill(updated)
      setDrafts(({[skill.id]: _dropped, ...rest}) => rest)
      setResetArmed(null)
      setError('')
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section
        aria-labelledby="app-skills-heading"
        className="rounded-xl border border-edge bg-surface p-6"
      >
        <h2 id="app-skills-heading" className="text-base font-semibold text-fg">
          Application Skills
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Instruction documents that teach how to use each part of Jax. Claude
          reads them through the MCP connection (the{' '}
          <code className="rounded bg-bg px-1 py-0.5 text-xs">list_skills</code>{' '}
          and{' '}
          <code className="rounded bg-bg px-1 py-0.5 text-xs">get_skill</code>{' '}
          tools), so edits here change how it works in that area — add your own
          conventions, naming rules, or workflow notes. Edited skills show a
          Customized badge and can be reset to the built-in default at any
          time.
        </p>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-4 flex flex-col gap-3">
          {skills === null && !error && (
            <p className="text-sm text-fg-muted">Loading skills…</p>
          )}
          {(skills ?? []).map((skill) => {
            const open = expanded === skill.id
            const value = drafts[skill.id] ?? skill.content
            const dirty = value !== skill.content
            const Chevron = open ? ChevronDown : ChevronRight
            return (
              <div
                key={skill.id}
                className="overflow-hidden rounded-lg border border-edge bg-bg"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    setExpanded(open ? null : skill.id)
                    setResetArmed(null)
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <Chevron
                    size={16}
                    aria-hidden
                    className="shrink-0 text-fg-muted"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {skill.title}
                      </span>
                      {skill.overridden && (
                        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                          Customized
                        </span>
                      )}
                      {dirty && (
                        <span className="text-[11px] font-medium text-fg-muted">
                          Unsaved changes
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-muted">
                      {skill.description}
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="border-t border-edge px-4 py-4">
                    <MarkdownField
                      key={`${skill.id}:${skill.overridden}`}
                      id={`skill-${skill.id}`}
                      value={value}
                      onChange={(next) => {
                        setDrafts((d) => ({...d, [skill.id]: next}))
                        setSavedId(null)
                      }}
                      placeholder="Skill instructions in markdown…"
                    />
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        disabled={!dirty}
                        onClick={() => save(skill)}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity disabled:opacity-50"
                      >
                        Save
                      </button>
                      {(skill.overridden || dirty) && (
                        <button
                          type="button"
                          onClick={() =>
                            resetArmed === skill.id
                              ? reset(skill)
                              : setResetArmed(skill.id)
                          }
                          className={clsx(
                            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                            resetArmed === skill.id
                              ? 'border-red-500/50 text-red-500 hover:bg-red-500/10'
                              : 'border-edge text-fg-muted hover:bg-surface-hover hover:text-fg',
                          )}
                        >
                          <RotateCcw size={14} aria-hidden />
                          {resetArmed === skill.id
                            ? 'Discard edits and reset?'
                            : 'Reset to default'}
                        </button>
                      )}
                      {savedId === skill.id && !dirty && (
                        <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
                          <Check size={16} aria-hidden />
                          Saved
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
