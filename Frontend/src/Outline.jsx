import { useContext } from "react";
import { MyContext } from "./MyContext.jsx";
import "./Outline.css";

function Outline() {
  const { prevChats } = useContext(MyContext);

  const outline = prevChats
    .map((chat, idx) => ({ ...chat, idx }))
    .filter((chat) => chat.role === "user");

  const scrollToPrompt = (idx) => {
    const element = document.getElementById(`msg-${idx}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // if new chat-: no show old msg
  if (!prevChats || prevChats.length === 0) {
    return null;
  }

  return (
    <div className="index-panel">
      <div className="index-panel-header">Chat Log</div>

      <div className="index-panel-list">
        {outline.map((chat) => (
          <div
            key={chat.idx}
            className="index-panel-row"
            onClick={() => scrollToPrompt(chat.idx)}
            style={{ cursor: "pointer" }}
          >
            {chat.content}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Outline;