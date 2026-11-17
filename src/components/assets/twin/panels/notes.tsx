"use client";
/** 3D view panel parts: notesBlock, notesPanel (wave 30: split out of twin-view.tsx; reads the view's state from useTwinView). */
import { NoteComposer, NoteList } from "../notes";
import type { TwinCtx } from "../use-twin-view";

export function NotesBlock({ t }: { t: TwinCtx }) {
  const { composer, data, focusNote, me, noteBusy, noteDelete, noteOnSelection, notePhoto, noteStatus, noteWhere, people, saveNote, selAsset, selNotes, selRoom, setComposer } = t;
  return <>{(
    <div className="mt-3 border-t border-[#123a55] pt-2">
      <p className="text-[13px] font-semibold text-[#5fd6ff]">Notes{selNotes.length ? ` (${selNotes.length})` : ""}</p>
      {selNotes.length > 0 && <div className="mt-1"><NoteList notes={selNotes} whereOf={noteWhere} me={me} canReport={data.can.report} onFocus={focusNote} onStatus={noteStatus} onDelete={noteDelete} onPhoto={notePhoto} /></div>}
      {composer && composer.floorId && (composer.assetId ? composer.assetId === selAsset?.id : composer.roomId === selRoom?.id && !selAsset) ? (
        <div className="mt-1.5"><NoteComposer where={composer.where} people={people} busy={noteBusy} onSave={saveNote} onCancel={() => setComposer(null)} /></div>
      ) : <button type="button" onClick={noteOnSelection} className="twin-act mt-1.5">Add a note {selAsset ? "on this device" : "in this room"}</button>}
    </div>
  )}</>;
}

export function NotesPanel({ t }: { t: TwinCtx }) {
  const { composer, composerOnSpot, data, focusNote, me, noteBusy, noteDelete, noteOnSpot, notePhoto, noteStatus, noteWhere, people, pickingSpot, saveNote, sceneRef, setComposer, setShowDone, showDone, shownNotes } = t;
  return <>{(
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={pickingSpot ? () => sceneRef.current?.cancelPickPoint() : noteOnSpot} className="twin-act" aria-pressed={pickingSpot}>{pickingSpot ? "Cancel" : "Note on a spot"}</button>
        <label className="flex items-center gap-1.5 text-xs text-[#8fb6cc]"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-[#2fd3ff]" />Show closed</label>
      </div>
      {pickingSpot && <p className="text-xs text-[#ffc46b]">Click the spot on the floor shown.</p>}
      {composerOnSpot && <NoteComposer where={composer!.where} people={people} busy={noteBusy} onSave={saveNote} onCancel={() => setComposer(null)} />}
      <NoteList notes={shownNotes} whereOf={noteWhere} me={me} canReport={data.can.report} onFocus={focusNote} onStatus={noteStatus} onDelete={noteDelete} onPhoto={notePhoto} />
      <p className="text-[11px] text-[#8fb6cc]">Select a room or device to add a note to it. Anyone who can see this hospital can add notes; the person a note is for gets a notification.</p>
    </div>
  )}</>;
}
