import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { updateSettings, useSettings } from "../settings";
import type { VideoLoraChoice, VideoLoraInfo, VideoModelId } from "../types";

export function VideoLoraCard({
  modelId,
  modelLabel,
  avail,
  max,
  onToast,
}: {
  modelId: VideoModelId;
  modelLabel: string;
  avail: VideoLoraInfo[];
  max: number;
  onToast: (msg: string) => void;
}) {
  const settings = useSettings();
  const loraKey = "h3Loras";
  const chosenRaw: VideoLoraChoice[] = settings.h3Loras || [];
  const list = chosenRaw.filter((l) => avail.some((a) => a.id === l.id));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("ca:nav", close);
    return () => window.removeEventListener("ca:nav", close);
  }, []);

  const fits = useMemo(() => {
    const term = search.trim().toLowerCase();
    return avail.filter((l) => !term || l.label.toLowerCase().includes(term) || l.id.toLowerCase().includes(term));
  }, [avail, search]);

  function setList(next: VideoLoraChoice[]) {
    updateSettings({ [loraKey]: next });
  }

  function remove(id: string) {
    setList(list.filter((c) => c.id !== id));
  }

  function setStrength(id: string, strength: number) {
    setList(list.map((c) => (c.id === id ? { ...c, strength } : c)));
  }

  function togglePick(id: string) {
    if (list.some((c) => c.id === id)) {
      remove(id);
      return;
    }
    if (list.length >= max) {
      onToast(`Up to ${max} LoRAs at once`);
      return;
    }
    setList([...list, { id, strength: 1 }]);
    setOpen(false);
  }

  if (!avail.length) {
    return (
      <>
        <div className="label">
          <span>LoRAs</span>
        </div>
        <div className="card loras">
          <small className="dim">
            No H3 LoRAs yet. Put MiniMax H3 FL2VA LoRAs (ComfyUI format) in the loras\h3 folder on the PC.
          </small>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="label">
        <span>LoRAs</span>
        <span>{list.length ? `${list.length} of ${max}` : ""}</span>
      </div>
      <div className="card loras">
        {list.map((c) => {
          const l = avail.find((a) => a.id === c.id);
          return (
            <div className="lora" key={c.id}>
              <div className="row">
                <b className="grow">{l?.label || c.id}</b>
                <button type="button" className="x" aria-label="Remove" onClick={() => remove(c.id)}>
                  <Icon name="x" />
                </button>
              </div>
              <div className="slider">
                <span>Strength</span>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={c.strength}
                  onChange={(e) => setStrength(c.id, +e.target.value)}
                />
                <output>{(+c.strength).toFixed(2)}</output>
              </div>
            </div>
          );
        })}
        {list.length < max && (
          <button
            type="button"
            className="addlora"
            onClick={() => {
              setSearch("");
              setOpen(true);
            }}
          >
            <Icon name="plus" />
            Add a LoRA for {modelLabel}
          </button>
        )}
        {list.length > 0 && (
          <small className="dim">Add the LoRA&apos;s trigger words to your prompt (see its Civitai page).</small>
        )}
      </div>

      {open && (
        <div
          className="sheet"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="sbox">
            <div className="row">
              <b className="grow">Add a LoRA for {modelLabel}</b>
              <button type="button" className="x" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="box">
              <input
                type="text"
                placeholder="Search your LoRAs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div id="vlList">
              {fits.length === 0 ? (
                <small className="dim">No LoRAs for this model{search.trim() ? " match that search" : " yet"}.</small>
              ) : (
                fits.map((l) => {
                  const on = list.some((c) => c.id === l.id);
                  const note = l.id;
                  return (
                    <button key={l.id} type="button" className={on ? "on" : ""} onClick={() => togglePick(l.id)}>
                      <div>
                        <b>{l.label}</b>
                        <small>{note}</small>
                      </div>
                      <Icon name={on ? "x" : "plus"} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
