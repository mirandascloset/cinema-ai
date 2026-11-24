import { Icon } from "../icons";

export type AppTab = "create" | "storyboard" | "scenes" | "gallery";

export function Tabs({ tab, onTab }: { tab: AppTab; onTab: (t: AppTab) => void }) {
  return (
    <div className="nav">
      <div className="who" id="tabs">
        <button type="button" className={tab === "create" ? "on" : ""} onClick={() => onTab("create")}>
          <Icon name="wand" />
          Create
        </button>
        <button type="button" className={tab === "storyboard" ? "on" : ""} onClick={() => onTab("storyboard")}>
          <Icon name="film" />
          Storyboard
        </button>
        <button type="button" className={tab === "scenes" ? "on" : ""} onClick={() => onTab("scenes")}>
          <Icon name="cast" />
          Scenes
        </button>
        <button type="button" className={tab === "gallery" ? "on" : ""} onClick={() => onTab("gallery")}>
          <Icon name="grid" />
          Gallery
        </button>
      </div>
    </div>
  );
}
