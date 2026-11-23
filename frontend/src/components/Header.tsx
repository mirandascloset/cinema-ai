import { Icon } from "../icons";
import { Tabs, type AppTab } from "./Tabs";

export function Header({
  subtitle,
  warn,
  queueCount,
  queueOpen,
  tab,
  onTab,
  onQueue,
}: {
  subtitle: string;
  warn: boolean;
  queueCount: number;
  queueOpen?: boolean;
  tab: AppTab;
  onTab: (t: AppTab) => void;
  onQueue: () => void;
}) {
  return (
    <header>
      <div className={`brand${warn ? " warn" : ""}`}>
        <div className="avatar">
          <Icon name="film" />
        </div>
        <div className="grow">
          <b>Cinema AI</b>
          <span>{subtitle}</span>
        </div>
        {(queueCount > 0 || queueOpen) && (
          <button type="button" id="queueBtn" className="qbtn" onClick={onQueue}>
            <Icon name="list" />
            Queue
            <span>{queueCount}</span>
          </button>
        )}
      </div>
      <Tabs tab={tab} onTab={onTab} />
    </header>
  );
}