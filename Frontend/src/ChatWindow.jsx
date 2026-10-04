import "./ChatWindow.css";
import Chat from "./Chat.jsx";
import AuthView from "./AuthView.jsx"; // AuthView import kiya
import { MyContext } from "./MyContext.jsx";
import { useContext, useState, useEffect, useRef } from "react";
import { ScaleLoader } from "react-spinners";
import { v1 as uuidv1 } from "uuid";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;


function ChatWindow() {
    const { prompt, setPrompt, reply, setReply, currThreadId, setCurrThreadId, setPrevChats, setNewChat, isTyping, isSidebarOpen, setIsSidebarOpen } = useContext(MyContext);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const isBusy = loading || isTyping;
    const controllerRef = useRef(null);
    const profileRef = useRef(null);

    // --- AUTH & LIMIT STATES ---
    const [token, setToken] = useState(localStorage.getItem("token"));
    const [authModal, setAuthModal] = useState(null); // 'login' | 'signup' | null
    const [limitOver, setLimitOver] = useState(false);

    const [errorMsg, setErrorMsg] = useState("");

    const resetChat = () => {
        setPrevChats([]);
        setNewChat(true);
        setReply(null);
        setPrompt("");
        setCurrThreadId(uuidv1());
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        setToken(null);
        setIsOpen(false);
        resetChat();
    };

    const handleAuthSuccess = (newToken) => {
        setToken(newToken);
        resetChat();
        setAuthModal(null);
        setLimitOver(false);
        setIsOpen(false);
    };

    const getReply = async () => {
        if (!prompt.trim() || isBusy || limitOver) return;

        // user login/signup pop if not authorised
        if (!token) {
            setAuthModal("login");
            return;
        }

        setErrorMsg("");

        const controller = new AbortController();
        controllerRef.current = controller;

        setLoading(true);
        setNewChat(false);

        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}` // Token attach kiya
            },
            body: JSON.stringify({
                message: prompt,
                threadId: currThreadId
            }),
            signal: controller.signal
        };

        try {
            const response = await fetch(`${BACKEND_URL}/api/chat`, options);

            // LIMIT OVER HANDLER 
            if (response.status === 429) {
                setLimitOver(true);
                return;
            }

            if (response.status === 401) {
                localStorage.removeItem("token");
                setToken(null);
                setAuthModal("login");
                return;
            }

            if (!response.ok) {
                setErrorMsg("Something went wrong. Please try again.");
                return;
            }

            const res = await response.json();

            if (controller.signal.aborted) return;
            setReply(res.reply);
        } catch (err) {
            if (err.name !== "AbortError") {
                console.log(err);
                setErrorMsg("Cannot reach the server. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const stopReply = () => {
        controllerRef.current?.abort();
        setReply(null);
    };

    // Append new chat to prevChats
    useEffect(() => {
        if (prompt && reply) {
            setPrevChats(prevChats => (
                [...prevChats, {
                    role: "user",
                    content: prompt
                }, {
                    role: "assistant",
                    content: reply
                }]
            ));
        }

        setPrompt("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reply]);

    const handleProfileClick = () => {
        setIsOpen(!isOpen);
    };

    // Close the user dropdown when clicking/tapping anywhere outside it, or pressing Esc
    useEffect(() => {
        if (!isOpen) return;
        const handleOutside = (e) => {
            if (profileRef.current && !profileRef.current.contains(e.target)) setIsOpen(false);
        };
        const handleEsc = (e) => {
            if (e.key === "Escape") setIsOpen(false);
        };
        document.addEventListener("mousedown", handleOutside);
        document.addEventListener("touchstart", handleOutside);
        document.addEventListener("keydown", handleEsc);
        return () => {
            document.removeEventListener("mousedown", handleOutside);
            document.removeEventListener("touchstart", handleOutside);
            document.removeEventListener("keydown", handleEsc);
        };
    }, [isOpen]);

    return (
        <div className="chatWindow">
            {isSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)}></div>}
       
            <div className="navbar" id="navbarNavDarkDropdown">
                <div className="mobile-menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                    <i className={`fa-solid ${isSidebarOpen ? "fa-xmark" : "fa-bars"}`}></i>
                </div>
  <span className="navbar-brand-dropdown">
   

    {/* <i className="fa-solid fa-chevron-down"></i> */}
  </span>
                <div className="userIconDiv" ref={profileRef} onClick={handleProfileClick}>
                    <span className="userIcon"><i className="fa-solid fa-user"></i></span>

                    {isOpen && (
                        <div className="dropdown" onClick={(e) => e.stopPropagation()}>
                            {token ? (
                                // LOGGED IN VIEW
                                <>
                                    <div className="dropdownItem"><i className="fa-solid fa-gear"></i> Settings</div>
                                    <div className="dropdownItem"><i className="fa-solid fa-cloud-arrow-up"></i> Upgrade plan</div>
                                    <div className="dropdownItem" onClick={handleLogout} style={{ cursor: "pointer" }}>
                                        <i className="fa-solid fa-arrow-right-from-bracket"></i> Log out
                                    </div>
                                </>
                            ) : (
                                // LOGGED OUT VIEW
                                <>
                                    <div className="dropdownItem" onClick={() => { setAuthModal("login"); setIsOpen(false); }} style={{ cursor: "pointer" }}>
                                        <i className="fa-solid fa-arrow-right-to-bracket"></i> Log in
                                    </div>
                                    <div className="dropdownItem" onClick={() => { setAuthModal("signup"); setIsOpen(false); }} style={{ cursor: "pointer" }}>
                                        <i className="fa-solid fa-user-plus"></i> Sign up
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <Chat />

            <ScaleLoader color="#fff" loading={loading} />

            {/* Daily Limit Warning Banner */}
            {limitOver && (
                <div style={{
                    backgroundColor: "#ef444420",
                    color: "#f87171",
                    border: "1px solid #ef444450",
                    borderRadius: "8px",
                    padding: "10px 16px",
                    margin: "0 auto 10px auto",
                    width: "fit-content",
                    fontSize: "14px",
                    textAlign: "center"
                }}>
                    ⚠️ Limit over today. Please try next day
                     I have limited access token or
                     switch model {"(Upcoming Feature soon...)"}
                </div>
            )}

            {errorMsg && (
                <div style={{
                    backgroundColor: "#ef444420",
                    color: "#f87171",
                    border: "1px solid #ef444450",
                    borderRadius: "8px",
                    padding: "10px 16px",
                    margin: "0 auto 10px auto",
                    width: "fit-content",
                    fontSize: "14px",
                    textAlign: "center"
                }}>
                    ⚠️ {errorMsg}
                </div>
            )}

            <div className="chatInput">
                <div className="inputBox">
                    <input
                        placeholder={limitOver ? "Daily limit reached..." : "Ask anything"}
                        value={prompt}
                        disabled={limitOver}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !isBusy && !limitOver) getReply();
                        }}
                    />

                    {isBusy ? (
                        <div id="submit" onClick={stopReply}>
                            <i className="fa-solid fa-stop"></i>
                        </div>
                    ) : (
                        <div id="submit" onClick={getReply} style={{ opacity: limitOver ? 0.4 : 1, cursor: limitOver ? "not-allowed" : "pointer" }}>
                            <i className="fa-solid fa-paper-plane"></i>
                        </div>
                    )}
                </div>
                <p className="info" style={{color:"red"}}>
                    Zexabao.ai can make mistakes. Limited Token Access Per Day.
                </p>
            </div>

            {/* Auth Modal Trigger */}
            {authModal && (
                <AuthView
                    initialMode={authModal}
                    onAuthSuccess={handleAuthSuccess}
                    onClose={() => setAuthModal(null)}
                />
            )}
        </div>
    );
}

export default ChatWindow;