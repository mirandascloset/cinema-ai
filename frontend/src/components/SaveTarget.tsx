import { useEffect, useState } from "react";
import { api, saveResults } from "../api";
import { Icon } from "../icons";
import { PcBrowser } from "./PcBrowser";

export type SaveItem = { id: string; video?: boolean };

type SaveResult = { saved: string[]; dir: string };

export function SaveTarget({
  items,
  onClose,
  onToast,
}: {
  items: SaveItem[] | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [pcOpen, setPcOpen] = useState(false);
  const [pending, setPending] = useState<SaveItem[]>([]);

  useEffect(() => {
    if (items?.length) {
      setPending(items);
      setChooserOpen(true);
      setPcOpen(false);
    }
  }, [items]);

  function dismissAll() {
    setChooserOpen(false);
    setPcOpen(false);
    setPending([]);
    onClose();
  }

  async function saveToDevice() {
    const list = pending;
    dismissAll();
    try {
      await saveResults(list);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      onToast("Couldn't save. Long-press it instead.");
    }
  }

  function openPc() {
    setChooserOpen(false);
    setPcOpen(true);
    onClose();
  }

  async function saveToPc(dir: string) {
    const list = pending;
    try {
      const r = await api<SaveResult>("/api/save", { ids: list.map((i) => i.id), dir });
      const where = r.dir || "Studio";
      onToast(r.saved.length === 1 ? `Saved to ${where}` : `Saved ${r.saved.length} to ${where}`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Couldn't save to the PC");
    }
    dismissAll();
  }

  if (!chooserOpen && !pcOpen) return null;

  return (
    <>
      {chooserOpen && (
        <div
          className="sheet"
          id="saveSheet"
          onClick={(e) => {
            if ((e.target as HTMLElement).id === "saveSheet") dismissAll();
          }}
        >
          <div className="sbox">
            <div className="row">
              <b className="grow">Save</b>
              <button type="button" className="x" aria-label="Close" onClick={dismissAll}>
                <Icon name="x" />
              </button>
            </div>
            <button type="button" className="src" onClick={() => void saveToDevice()}>
              <Icon name="image" />
              <div>
                <b>To this device</b>
                <small>Share sheet or download</small>
              </div>
            </button>
            <button type="button" className="src" onClick={openPc}>
              <Icon name="folder" />
              <div>
                <b>To the PC</b>
                <small>Save to Studio or Google Drive</small>
              </div>
            </button>
          </div>
        </div>
      )}
      <PcBrowser
        open={pcOpen}
        mode="folder"
        onClose={dismissAll}
        onPickFolder={(dir) => void saveToPc(dir)}
        onToast={onToast}
      />
    </>
  );
}