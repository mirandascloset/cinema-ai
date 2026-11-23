import { Icon } from "../icons";
import type { UploadMeta } from "../types";
import { useSourcePicker } from "./SourcePicker";

export function PhotoBox({
  image,
  onPicked,
  picking,
  onToast,
}: {
  image: UploadMeta | null;
  onPicked: (meta: UploadMeta) => void;
  picking?: boolean;
  onToast?: (msg: string) => void;
}) {
  const { openPicker } = useSourcePicker();

  function open() {
    if (picking) return;
    openPicker({
      kind: "image",
      onImage: onPicked,
      onToast,
      title: "Choose a photo",
    });
  }

  return (
    <div className={`photo${image ? " has" : ""} sm`} onClick={() => !image && open()} role={image ? undefined : "button"}>
      {!image ? (
        <div className="pick">
          <div className="avatar">
            <Icon name="image" />
          </div>
          <b>{picking ? "Uploading…" : "Choose a photo"}</b>
          <span>This becomes the first frame of your clip</span>
        </div>
      ) : (
        <>
          <img src={`/api/upload/${image.id}`} alt="" />
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