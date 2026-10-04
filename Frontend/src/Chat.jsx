import "./Chat.css";
import { useContext, useState, useEffect } from "react";
import { MyContext } from "./MyContext";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import stickerImg from "./assets/stickernewchat.png";

function Chat() {
    const { newChat, prevChats, reply,setIsTyping} = useContext(MyContext);
    const [latestReply, setLatestReply] = useState(null);

    useEffect(() => {
        if (reply === null) {
            const timer = setTimeout(() => {
                setLatestReply(null);
            }, 0);
            return () => clearTimeout(timer);
        }

        if (!prevChats?.length) return;

        const content = reply.split(" ");
        let idx = 0;
        setIsTyping(true);
        const interval = setInterval(() => {
            setLatestReply(content.slice(0, idx + 1).join(" "));
            idx++;
            if (idx >= content.length) {
                clearInterval(interval);
                setIsTyping(false);
            }
        }, 40);

      return () => {
    clearInterval(interval);
    setIsTyping(false);
};
}, [prevChats, reply, setIsTyping]);

    return (
        <>
            {newChat && 

         <div className="new-chat-placeholder">
  <div className="chat-sticker-wrapper">
    <img 
      src={stickerImg} 
      alt="Cute Panda Waving" 
      className="chat-welcome-sticker"
    />
  </div>
  <h2 className="welcome-heading">Hey! How can I help you today?</h2>

</div>



     

            }
            <div className="chats">
                {
                    prevChats?.slice(0, -1).map((chat, idx) => 
                        <div
                            className={chat.role === "user" ? "userDiv" : "gptDiv"}
                            id={`msg-${idx}`}
                            key={idx}
                        >
                            {
                                chat.role === "user" ? 
                                <p className="userMessage">{chat.content}</p> : 
                                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{chat.content}</ReactMarkdown>
                            }
                        </div>
                    )
                }

                {
                    prevChats?.length > 0 && (
                        latestReply === null ? (
                            <div
                                className="gptDiv"
                                id={`msg-${prevChats.length - 1}`}
                                key="non-typing"
                            >
                                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                                    {prevChats[prevChats.length - 1].content}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <div
                                className="gptDiv"
                                id={`msg-${prevChats.length - 1}`}
                                key="typing"
                            >
                                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                                    {latestReply}
                                </ReactMarkdown>
                            </div>
                        )
                    )
                }
            </div>
        </>
    );
}

export default Chat;