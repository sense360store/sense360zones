/*
 * React bindings for the store. Components read state with `useEditorState()`
 * and call actions on the exported `store` singleton.
 */
import { useSyncExternalStore } from 'react'
import type { EditorState } from './store'
import { store } from './instance'

/** Subscribe to the whole editor state; re-renders on any change. */
export function useEditorState(): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

export { store }
