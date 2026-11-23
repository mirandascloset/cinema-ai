import { Icon } from "../icons";
import type { VideoMeta } from "../types";
import { useSourcePicker } from "./SourcePicker";

export function VideoBox({
  video,
  onPicked,
  picking,
  onToast,
}: {
  video: VideoMeta | null;
  onPicked: (meta: VideoMeta) => void;
  picking?: boolean;
  onToast?: (msg: string) => void;
}) {
  const { openPicker } = useSourcePicker();

  function open() {
    if (picking) return;
    openPicker({
      kind: "video",
      onVideo: onPicked,
      onToast,
      title: "Choose a reference video",
    });
  }

  return (
    <div className={`photo${video ? " has" : ""}`} onClick={() => !video && open()} role={video ? undefined : "button"}>
      {!video ? (
        <div className="pick">
          <div className="avatar">
            <Icon name="film" />
          </div>
          <b>{picking ? "Uploading…" : "Choose a reference video"}</b>
          <span>AI studies it in 10-second slices</span>
        </div>
      ) : (
        <>
          <video src={`/api/video/${video.id}`} controls playsInline muted className="preview" />
          <div className="over">
            <button
              type="button"
              disabled={picking}
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
            >
              {picking ? "Uploading…" : "Change"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}