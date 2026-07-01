import { useEffect, useState } from 'react'

/**
 * Controlled-on-commit input. Mirrors the prototype's text/number fields, which
 * used the browser's native `change` event (fires on blur / Enter). Local state
 * lets the user type freely; the value resyncs from props whenever the field is
 * not focused (e.g. when a zone is dragged on the canvas).
 */
export function Field(props: {
  value: string
  onCommit: (val: string) => void
  type?: string
  step?: string
  className?: string
}) {
  const { value, onCommit, type = 'text', step, className } = props
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setLocal(value)
  }, [value, focused])

  return (
    <input
      type={type}
      step={step}
      className={className}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        setFocused(false)
        onCommit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
