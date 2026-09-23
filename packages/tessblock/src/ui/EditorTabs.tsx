/** Tabs over the working area: blocks, costumes, sounds and properties. */
import { useEffect, useRef } from 'preact/hooks';
import { selectedObject } from '../model/store.ts';
import { mount, resize, unmount } from './blockly-host.ts';
import { SoundPane } from './AssetPanes.tsx';
import { CostumePane } from './CostumePane.tsx';
import { PropertyPane } from './PropertyPane.tsx';
import { FunctionEditor } from './FunctionEditor.tsx';
import { SearchIcon } from './icons.tsx';
import { blockQuery, editorTab, functionDraft, propertyTab, type EditorTab } from './state.ts';

const TABS: Array<[EditorTab, string]> = [
  ['blocks', '블록'],
  ['costumes', '모양'],
  ['sounds', '소리'],
  ['properties', '속성'],
];

export function EditorTabs() {
  const object = selectedObject.value;
  const tab = editorTab.value;

  // Making a function takes over the work area; the stage and the object list
  // stay where they are.
  if (functionDraft.value) return <FunctionEditor />;

  return (
    <>
      <div class="tabbar">
        {TABS.map(([key, label]) => (
          <button key={key} class={`tabbtn ${tab === key ? 'on' : ''}`} onClick={() => { editorTab.value = key; }}>
            {label}
            {key === 'costumes' && object && <span class="n">{object.costumes.length}</span>}
            {key === 'sounds' && object && <span class="n">{object.sounds.length}</span>}
          </button>
        ))}
        <span class="note">{object ? object.name : '오브젝트 없음'}</span>
      </div>
      <div class="canvas">
        {/* Properties sit beside the blocks, not on top of them. */}
        <BlockPane hidden={tab === 'costumes' || tab === 'sounds'} />
        {tab === 'costumes' && <CostumePane />}
        {tab === 'sounds' && <SoundPane />}
        {tab === 'properties' && (
          <aside class={`prop-panel ${propertyTab.value === 'table' ? 'wide' : ''}`}>
            <PropertyPane />
          </aside>
        )}
      </div>
    </>
  );
}

/** The workspace stays mounted behind the other tabs so its state survives. */
function BlockPane({ hidden }: { hidden: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return undefined;
    mount(host.current);
    const observer = new ResizeObserver(() => resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      unmount();
    };
  }, []);

  useEffect(() => {
    if (!hidden) requestAnimationFrame(() => resize());
  }, [hidden]);

  // `display: none` rather than hiding it: a hidden workspace must not take
  // clicks or keys while another tab is in front.
  return (
    <div class="block-pane" style={{ display: hidden ? 'none' : 'block' }}>
      <BlockSearch />
      <div class="blockly-host" ref={host} />
    </div>
  );
}

/** Finds blocks across every category and puts the hits in the palette. */
function BlockSearch() {
  const query = blockQuery.value;
  return (
    <div class={`block-search ${query ? 'on' : ''}`}>
      <SearchIcon />
      <input
        value={query}
        placeholder="블록 찾기"
        aria-label="블록 찾기"
        onInput={(event) => { blockQuery.value = (event.target as HTMLInputElement).value; }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') blockQuery.value = '';
        }}
      />
      {query && (
        <button class="clear" title="검색 지우기" onClick={() => { blockQuery.value = ''; }}>✕</button>
      )}
    </div>
  );
}
