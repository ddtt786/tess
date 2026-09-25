/** A label that turns into a field when it is double-clicked. */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  class?: string;
  title?: string;
}

export function InlineName({ value, onCommit, class: className = '', title }: Props) {
  const editing = useSignal(false);
  const draft = useSignal(value);
  const field = useRef<HTMLInputElement>(null);

  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (editing.value) field.current?.select();
  }, [editing.value]);

  // In a record row, a double click anywhere on the row renames, not only on the letters.
  useEffect(() => {
    const row = label.current?.closest<HTMLElement>('.rec-row, .rec');
    if (editing.value || !row) return undefined;
    const rename = (event: MouseEvent) => {
      if ((event.target as Element).closest('button, input, select, textarea, a')) return;
      draft.value = value;
      editing.value = true;
    };
    row.addEventListener('dblclick', rename);
    return () => row.removeEventListener('dblclick', rename);
  }, [editing.value, value]);

  function commit() {
    editing.value = false;
    const next = draft.value.trim();
    if (next && next !== value) onCommit(next);
  }

  if (!editing.value) {
    return (
      <span
        ref={label}
        class={className}
        title={title ?? '두 번 눌러 이름 바꾸기'}
        onDblClick={(event) => {
          event.stopPropagation();
          draft.value = value;
          editing.value = true;
        }}
      >
        {value}
      </span>
    );
  }

  return (
    <input
      ref={field}
      class={`inline-name ${className}`}
      value={draft.value}
      // The row around it (a drag handle, a button) must not take presses or keys meant for the text.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onInput={(event) => { draft.value = (event.target as HTMLInputElement).value; }}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          editing.value = false;
        }
      }}
    />
  );
}
